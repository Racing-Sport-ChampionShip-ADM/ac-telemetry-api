const express = require('express');
const crypto = require('crypto');
const pool = require('../db/pool');
const { autenticarPiloto } = require('../middleware/auth');

const router = express.Router();

/**
 * POST /api/pilotos
 * Registro de un nuevo piloto. Genera y devuelve el api_key (única vez que se muestra completo).
 * Body: { nombre_piloto, numero_piloto, steam_id?, email? }
 */
router.post('/', async (req, res) => {
  const { nombre_piloto, numero_piloto, steam_id, email } = req.body;

  if (!nombre_piloto || !numero_piloto) {
    return res.status(400).json({ error: 'nombre_piloto y numero_piloto son requeridos' });
  }

  const apiKey = crypto.randomBytes(32).toString('hex');

  try {
    const result = await pool.query(
      `insert into piloto (nombre_piloto, numero_piloto, steam_id, email, api_key)
       values ($1, $2, $3, $4, $5)
       returning id, nombre_piloto, numero_piloto, steam_id, email, fecha_registro`,
      [nombre_piloto, numero_piloto, steam_id || null, email || null, apiKey]
    );

    res.status(201).json({
      piloto: result.rows[0],
      api_key: apiKey, // el frontend debe mostrarlo una vez y avisar al usuario que lo guarde
    });
  } catch (err) {
    if (err.code === '23505') {
      // unique_violation: numero_piloto, steam_id o email duplicado
      return res.status(409).json({ error: 'Ya existe un piloto con ese número, steam_id o email' });
    }
    console.error('Error creando piloto:', err);
    res.status(500).json({ error: 'Error interno creando piloto' });
  }
});

/**
 * GET /api/pilotos/me
 * Devuelve el perfil del piloto autenticado (vía api_key), con sus autos y records.
 */
router.get('/me', autenticarPiloto, async (req, res) => {
  try {
    const piloto = req.piloto;

    const autos = await pool.query(
      `select a.id as auto_id, a.nombre_interno, a.nombre_visible, a.marca, a.categoria,
              pa.km_totales, pa.vueltas_totales, pa.ultima_vez_usado
       from piloto_auto pa
       join auto a on a.id = pa.auto_id
       where pa.piloto_id = $1
       order by pa.ultima_vez_usado desc nulls last`,
      [piloto.id]
    );

    const records = await pool.query(
      `select rv.auto_id, a.nombre_visible as auto_nombre,
              rv.circuito_id, c.nombre_visible as circuito_nombre, c.layout,
              rv.tiempo_ms, rv.fecha
       from record_vuelta rv
       join auto a on a.id = rv.auto_id
       join circuito c on c.id = rv.circuito_id
       where rv.piloto_id = $1
       order by rv.fecha desc`,
      [piloto.id]
    );

    res.json({
      piloto,
      autos: autos.rows,
      records: records.rows,
    });
  } catch (err) {
    console.error('Error obteniendo perfil:', err);
    res.status(500).json({ error: 'Error interno obteniendo perfil' });
  }
});

/**
 * GET /api/pilotos/:id/perfil
 * Perfil público de un piloto (para que el frontend muestre el dashboard de cualquier piloto).
 */
router.get('/:id/perfil', async (req, res) => {
  const { id } = req.params;

  try {
    const piloto = await pool.query(
      'select id, nombre_piloto, numero_piloto, avatar_url, pais, fecha_registro from piloto where id = $1',
      [id]
    );

    if (piloto.rows.length === 0) {
      return res.status(404).json({ error: 'Piloto no encontrado' });
    }

    const autos = await pool.query(
      `select a.id as auto_id, a.nombre_visible, a.marca, a.categoria,
              pa.km_totales, pa.vueltas_totales
       from piloto_auto pa
       join auto a on a.id = pa.auto_id
       where pa.piloto_id = $1`,
      [id]
    );

    const records = await pool.query(
      `select rv.auto_id, a.nombre_visible as auto_nombre,
              rv.circuito_id, c.nombre_visible as circuito_nombre,
              rv.tiempo_ms, rv.fecha
       from record_vuelta rv
       join auto a on a.id = rv.auto_id
       join circuito c on c.id = rv.circuito_id
       where rv.piloto_id = $1`,
      [id]
    );

    res.json({ piloto: piloto.rows[0], autos: autos.rows, records: records.rows });
  } catch (err) {
    console.error('Error obteniendo perfil público:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

module.exports = router;
