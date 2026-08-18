const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const pool = require('../db/pool');
const { autenticarPiloto } = require('../middleware/auth');

const router = express.Router();

const SALT_ROUNDS = 10;

/**
 * POST /api/pilotos
 * Registro de un nuevo piloto. Genera y devuelve el api_key (única vez que se muestra completo).
 * Body: { nombre_piloto, numero_piloto, steam_id?, email, password }
 *
 * email y password son requeridos para poder loguearse después desde la
 * Companion App (POST /api/auth/login). La api_key sigue existiendo y es
 * la que usa la app in-game / la Companion una vez logueada.
 */
router.post('/', async (req, res) => {
  const { nombre_piloto, numero_piloto, steam_id, email, password } = req.body;

  if (!nombre_piloto || !numero_piloto) {
    return res.status(400).json({ error: 'nombre_piloto y numero_piloto son requeridos' });
  }
  if (!email || !password) {
    return res.status(400).json({ error: 'email y password son requeridos' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
  }

  const apiKey = crypto.randomBytes(32).toString('hex');
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  try {
    const result = await pool.query(
      `insert into piloto (nombre_piloto, numero_piloto, steam_id, email, api_key, password_hash)
       values ($1, $2, $3, $4, $5, $6)
       returning id, nombre_piloto, numero_piloto, steam_id, email, fecha_registro`,
      [nombre_piloto, numero_piloto, steam_id || null, email, apiKey, passwordHash]
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
      `select a.id as auto_id, a.nombre_interno, a.nombre_visible, a.marca, a.categoria, a.imagen_url as auto_imagen,
              pa.km_totales, pa.vueltas_totales, pa.ultima_vez_usado
       from piloto_auto pa
       join auto a on a.id = pa.auto_id
       where pa.piloto_id = $1
       order by pa.ultima_vez_usado desc nulls last`,
      [piloto.id]
    );

    const records = await pool.query(
      `select rv.auto_id, a.nombre_visible as auto_nombre, a.imagen_url as auto_imagen,
              rv.circuito_id, c.nombre_visible as circuito_nombre, c.layout, c.imagen_url as circuito_imagen,
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
 * GET /api/pilotos/me/circuitos
 * Devuelve, para el piloto autenticado, un resumen por cada circuito
 * donde haya dado al menos una vuelta: imagen, vueltas totales,
 * cantidad de sesiones, y el record histórico (auto, tiempo, fecha).
 * Pensado para la vista "Records" (una card por pista).
 */
router.get('/me/circuitos', autenticarPiloto, async (req, res) => {
  try {
    const circuitos = await pool.query(
      `select
         c.id as circuito_id,
         c.nombre_visible as circuito_nombre,
         c.nombre_interno,
         c.layout,
         c.imagen_url as circuito_imagen,
         count(distinct s.id) as sesiones_totales,
         count(v.id) as vueltas_totales,
         min(v.tiempo_ms) filter (where v.valida) as mejor_tiempo_ms
       from sesion s
       join circuito c on c.id = s.circuito_id
       left join vuelta v on v.sesion_id = s.id
       where s.piloto_id = $1
       group by c.id, c.nombre_visible, c.nombre_interno, c.layout, c.imagen_url
       order by c.nombre_visible nulls last, c.nombre_interno`,
      [req.piloto.id]
    );

    // Para cada circuito, buscamos con que auto y cuando se logro el
    // record (la query de arriba no puede traer eso sin duplicar filas).
    const conRecord = await Promise.all(
      circuitos.rows.map(async (c) => {
        if (!c.mejor_tiempo_ms) {
          return { ...c, record_auto: null, record_fecha: null };
        }
        const record = await pool.query(
          `select a.nombre_visible as record_auto, v.fecha as record_fecha
           from vuelta v
           join sesion s on s.id = v.sesion_id
           join auto a on a.id = s.auto_id
           where s.piloto_id = $1 and s.circuito_id = $2
             and v.tiempo_ms = $3 and v.valida
           order by v.fecha asc
           limit 1`,
          [req.piloto.id, c.circuito_id, c.mejor_tiempo_ms]
        );
        return { ...c, ...(record.rows[0] || { record_auto: null, record_fecha: null }) };
      })
    );

    res.json({ circuitos: conRecord });
  } catch (err) {
    console.error('Error obteniendo circuitos del piloto:', err);
    res.status(500).json({ error: 'Error interno obteniendo circuitos' });
  }
});

/**
 * GET /api/pilotos/me/circuitos/:circuito_id
 * Detalle de un circuito para el piloto autenticado: record historico
 * destacado + lista de sesiones (fecha real, auto, vueltas, mejor
 * vuelta de esa sesion).
 */
router.get('/me/circuitos/:circuito_id', autenticarPiloto, async (req, res) => {
  const { circuito_id } = req.params;

  try {
    const circuito = await pool.query(
      `select id as circuito_id, nombre_visible as circuito_nombre, nombre_interno,
              layout, imagen_url as circuito_imagen
       from circuito where id = $1`,
      [circuito_id]
    );
    if (circuito.rows.length === 0) {
      return res.status(404).json({ error: 'Circuito no encontrado' });
    }

    const sesiones = await pool.query(
      `select
         s.id as sesion_id,
         s.fecha_inicio,
         s.fecha_fin,
         a.id as auto_id,
         a.nombre_visible as auto_nombre,
         a.imagen_url as auto_imagen,
         count(v.id) as vueltas_totales,
         min(v.tiempo_ms) filter (where v.valida) as mejor_tiempo_ms
       from sesion s
       join auto a on a.id = s.auto_id
       left join vuelta v on v.sesion_id = s.id
       where s.piloto_id = $1 and s.circuito_id = $2
       group by s.id, s.fecha_inicio, s.fecha_fin, a.id, a.nombre_visible, a.imagen_url
       order by s.fecha_inicio desc`,
      [req.piloto.id, circuito_id]
    );

    const record = await pool.query(
      `select a.nombre_visible as record_auto, a.imagen_url as record_auto_imagen,
              v.tiempo_ms as record_tiempo_ms, v.fecha as record_fecha
       from vuelta v
       join sesion s on s.id = v.sesion_id
       join auto a on a.id = s.auto_id
       where s.piloto_id = $1 and s.circuito_id = $2 and v.valida
       order by v.tiempo_ms asc
       limit 1`,
      [req.piloto.id, circuito_id]
    );

    res.json({
      circuito: circuito.rows[0],
      record: record.rows[0] || null,
      sesiones: sesiones.rows,
    });
  } catch (err) {
    console.error('Error obteniendo detalle de circuito:', err);
    res.status(500).json({ error: 'Error interno obteniendo detalle de circuito' });
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
      `select a.id as auto_id, a.nombre_visible, a.marca, a.categoria, a.imagen_url as auto_imagen,
              pa.km_totales, pa.vueltas_totales
       from piloto_auto pa
       join auto a on a.id = pa.auto_id
       where pa.piloto_id = $1`,
      [id]
    );

    const records = await pool.query(
      `select rv.auto_id, a.nombre_visible as auto_nombre, a.imagen_url as auto_imagen,
              rv.circuito_id, c.nombre_visible as circuito_nombre, c.imagen_url as circuito_imagen,
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
