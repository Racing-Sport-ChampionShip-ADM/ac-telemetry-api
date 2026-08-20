const express = require('express');
const pool = require('../db/pool');
const { autenticarPiloto } = require('../middleware/auth');
const { obtenerOCrearAuto, obtenerOCrearCircuito } = require('../db/catalogos');
const { descargarArchivoPrivado } = require('../storage/supabaseStorage');

const router = express.Router();

/**
 * POST /api/setups
 * La app in-game sube el setup activo (leído automáticamente del disco).
 *
 * Body:
 * {
 *   auto: { nombre_interno, ... },
 *   circuito: { nombre_interno, layout?, ... },
 *   nombre_setup,
 *   contenido: { ...valores del .ini parseado a JSON... }
 * }
 */
router.post('/', autenticarPiloto, async (req, res) => {
  const { auto, circuito, nombre_setup, contenido } = req.body;

  if (!auto?.nombre_interno || !circuito?.nombre_interno || !contenido) {
    return res.status(400).json({ error: 'auto, circuito y contenido son requeridos' });
  }

  try {
    const autoId = await obtenerOCrearAuto(auto);
    const circuitoId = await obtenerOCrearCircuito(circuito);

    const result = await pool.query(
      `insert into setup (piloto_id, auto_id, circuito_id, nombre_setup, contenido)
       values ($1, $2, $3, $4, $5)
       returning id, nombre_setup, fecha_captura`,
      [req.piloto.id, autoId, circuitoId, nombre_setup || null, JSON.stringify(contenido)]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error guardando setup:', err);
    res.status(500).json({ error: 'Error interno guardando setup' });
  }
});

/**
 * GET /api/setups?auto_id=&circuito_id=
 * Lista los setups del piloto autenticado, opcionalmente filtrados por auto/circuito.
 */
router.get('/', autenticarPiloto, async (req, res) => {
  const { auto_id, circuito_id } = req.query;

  try {
    const condiciones = ['piloto_id = $1'];
    const valores = [req.piloto.id];

    if (auto_id) {
      valores.push(auto_id);
      condiciones.push(`auto_id = $${valores.length}`);
    }
    if (circuito_id) {
      valores.push(circuito_id);
      condiciones.push(`circuito_id = $${valores.length}`);
    }

    const result = await pool.query(
      `select id, auto_id, circuito_id, nombre_setup, contenido, fecha_captura
       from setup
       where ${condiciones.join(' and ')}
       order by fecha_captura desc`,
      valores
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Error listando setups:', err);
    res.status(500).json({ error: 'Error interno listando setups' });
  }
});

async function obtenerVersionPropia(id, pilotoId) {
  const result = await pool.query(
    `select id, nombre_archivo, storage_path from session_setup_version
     where id = $1 and piloto_id = $2`,
    [id, pilotoId]
  );
  return result.rows[0] || null;
}

router.get('/:id/contenido', autenticarPiloto, async (req, res) => {
  try {
    const setup = await obtenerVersionPropia(req.params.id, req.piloto.id);
    if (!setup) return res.status(404).json({ error: 'Setup no encontrado' });
    const contenido = await descargarArchivoPrivado('session-setups', setup.storage_path);
    res.type('text/plain; charset=utf-8').send(contenido.toString('utf8'));
  } catch (err) {
    console.error('Error obteniendo contenido de setup:', err);
    res.status(500).json({ error: 'Error interno obteniendo el setup' });
  }
});

router.get('/:id/descargar', autenticarPiloto, async (req, res) => {
  try {
    const setup = await obtenerVersionPropia(req.params.id, req.piloto.id);
    if (!setup) return res.status(404).json({ error: 'Setup no encontrado' });
    const contenido = await descargarArchivoPrivado('session-setups', setup.storage_path);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${setup.nombre_archivo.replace(/"/g, '_')}"`);
    res.send(contenido);
  } catch (err) {
    console.error('Error descargando setup:', err);
    res.status(500).json({ error: 'Error interno descargando el setup' });
  }
});

module.exports = router;
