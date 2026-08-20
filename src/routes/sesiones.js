const express = require('express');
const crypto = require('crypto');
const pool = require('../db/pool');
const { autenticarPiloto } = require('../middleware/auth');
const { obtenerOCrearAuto, obtenerOCrearCircuito } = require('../db/catalogos');
const { subirArchivoPrivado, descargarArchivoPrivado } = require('../storage/supabaseStorage');

const router = express.Router();

/**
 * POST /api/sesiones
 * La app in-game llama esto cuando el piloto empieza a jugar (carga un auto+circuito).
 * Auto-crea auto/circuito si no existen.
 *
 * Body:
 * {
 *   auto: { nombre_interno, nombre_visible?, marca?, categoria? },
 *   circuito: { nombre_interno, layout?, nombre_visible?, longitud_metros? },
 *   fecha_inicio? (ISO string, default: ahora)
 * }
 */
router.post('/', autenticarPiloto, async (req, res) => {
  const { auto, circuito, fecha_inicio } = req.body;

  if (!auto?.nombre_interno || !circuito?.nombre_interno) {
    return res.status(400).json({ error: 'auto.nombre_interno y circuito.nombre_interno son requeridos' });
  }

  try {
    const autoId = await obtenerOCrearAuto(auto);
    const circuitoId = await obtenerOCrearCircuito(circuito);

    const result = await pool.query(
      `insert into sesion (piloto_id, auto_id, circuito_id, fecha_inicio, origen)
       values ($1, $2, $3, coalesce($4, now()), 'in_game')
       returning id, fecha_inicio`,
      [req.piloto.id, autoId, circuitoId, fecha_inicio || null]
    );

    res.status(201).json({
      sesion_id: result.rows[0].id,
      auto_id: autoId,
      circuito_id: circuitoId,
      fecha_inicio: result.rows[0].fecha_inicio,
    });
  } catch (err) {
    console.error('Error creando sesión:', err);
    res.status(500).json({ error: 'Error interno creando sesión' });
  }
});

const MAX_SETUP_BYTES = 1500000;
const SETUPS_BUCKET = 'session-setups';

function nombreSeguro(nombre) {
  const base = String(nombre || 'setup.ini').replace(/[\\/:*?"<>|]/g, '_').replace(/^\.+/, '');
  return base.toLowerCase().endsWith('.ini') ? base : `${base}.ini`;
}

async function obtenerSetupPropio(setupId, pilotoId) {
  const result = await pool.query(
    `select id, sesion_id, piloto_id, nombre_archivo, storage_path, tamano_bytes,
            modificado_en_origen, detectado_en, version
     from session_setup_version where id = $1 and piloto_id = $2`,
    [setupId, pilotoId]
  );
  return result.rows[0] || null;
}

/**
 * POST /api/sesiones/:id/setups
 * Guarda una versión inmutable del .ini de la sesión. El cliente puede enviar
 * el mismo contenido más de una vez: cada guardado real conserva su snapshot.
 * Body: { nombre_archivo, contenido_base64, modificado_en_origen? }
 */
router.post('/:id/setups', autenticarPiloto, async (req, res) => {
  const { id } = req.params;
  const { nombre_archivo, contenido_base64, modificado_en_origen } = req.body;
  if (!contenido_base64 || typeof contenido_base64 !== 'string') {
    return res.status(400).json({ error: 'contenido_base64 es requerido' });
  }

  let contenido;
  try {
    contenido = Buffer.from(contenido_base64, 'base64');
  } catch (_) {
    return res.status(400).json({ error: 'contenido_base64 inválido' });
  }
  if (!contenido.length || contenido.length > MAX_SETUP_BYTES) {
    return res.status(400).json({ error: `El setup debe pesar entre 1 y ${MAX_SETUP_BYTES} bytes` });
  }

  try {
    const sesion = await pool.query('select id from sesion where id = $1 and piloto_id = $2', [id, req.piloto.id]);
    if (!sesion.rows.length) return res.status(404).json({ error: 'Sesión no encontrada o no pertenece a este piloto' });

    const siguiente = await pool.query(
      'select coalesce(max(version), 0) + 1 as version from session_setup_version where sesion_id = $1',
      [id]
    );
    const version = siguiente.rows[0].version;
    const archivo = nombreSeguro(nombre_archivo);
    const storagePath = `${req.piloto.id}/${id}/${String(version).padStart(4, '0')}-${crypto.randomUUID()}-${archivo}`;
    await subirArchivoPrivado(SETUPS_BUCKET, storagePath, contenido, 'text/plain; charset=utf-8');

    const result = await pool.query(
      `insert into session_setup_version
       (sesion_id, piloto_id, nombre_archivo, storage_path, tamano_bytes, modificado_en_origen, version)
       values ($1, $2, $3, $4, $5, $6, $7)
       returning id, nombre_archivo, tamano_bytes, modificado_en_origen, detectado_en, version`,
      [id, req.piloto.id, archivo, storagePath, contenido.length, modificado_en_origen || null, version]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error guardando versión de setup:', err);
    res.status(500).json({ error: 'Error interno guardando el setup' });
  }
});

/** Devuelve sesión, sus vueltas y los snapshots de setup al dueño. */
router.get('/:id', autenticarPiloto, async (req, res) => {
  const { id } = req.params;
  try {
    const sesion = await pool.query(
      `select s.id as sesion_id, s.fecha_inicio, s.fecha_fin, s.km_recorridos,
              a.nombre_visible as auto_nombre, a.imagen_url as auto_imagen,
              c.nombre_visible as circuito_nombre, c.nombre_interno as circuito_interno,
              c.layout, c.imagen_url as circuito_imagen,
              count(v.id) as vueltas_totales,
              min(v.tiempo_ms) filter (where v.valida) as mejor_tiempo_ms
       from sesion s
       join auto a on a.id = s.auto_id
       join circuito c on c.id = s.circuito_id
       left join vuelta v on v.sesion_id = s.id
       where s.id = $1 and s.piloto_id = $2
       group by s.id, s.fecha_inicio, s.fecha_fin, s.km_recorridos,
                a.nombre_visible, a.imagen_url, c.nombre_visible, c.nombre_interno, c.layout, c.imagen_url`,
      [id, req.piloto.id]
    );
    if (!sesion.rows.length) return res.status(404).json({ error: 'Sesión no encontrada o no pertenece a este piloto' });
    const setups = await pool.query(
      `select id, nombre_archivo, tamano_bytes, modificado_en_origen, detectado_en, version
       from session_setup_version where sesion_id = $1 and piloto_id = $2 order by version desc`,
      [id, req.piloto.id]
    );
    res.json({ sesion: sesion.rows[0], setups: setups.rows });
  } catch (err) {
    console.error('Error obteniendo detalle de sesión:', err);
    res.status(500).json({ error: 'Error interno obteniendo la sesión' });
  }
});

router.get('/:id/setups', autenticarPiloto, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      `select id, nombre_archivo, tamano_bytes, modificado_en_origen, detectado_en, version
       from session_setup_version where sesion_id = $1 and piloto_id = $2 order by version desc`,
      [id, req.piloto.id]
    );
    res.json({ setups: result.rows });
  } catch (err) {
    console.error('Error listando setups de sesión:', err);
    res.status(500).json({ error: 'Error interno listando los setups' });
  }
});

/**
 * PUT /api/sesiones/:id/cerrar
 * La app in-game llama esto cuando el piloto sale del juego o cambia de auto/circuito.
 */
router.put('/:id/cerrar', autenticarPiloto, async (req, res) => {
  const { id } = req.params;
  const { fecha_fin } = req.body;

  try {
    const result = await pool.query(
      `update sesion set fecha_fin = coalesce($1, now())
       where id = $2 and piloto_id = $3
       returning id, fecha_fin`,
      [fecha_fin || null, id, req.piloto.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Sesión no encontrada o no pertenece a este piloto' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error cerrando sesión:', err);
    res.status(500).json({ error: 'Error interno cerrando sesión' });
  }
});

/**
 * PUT /api/sesiones/:id/distancia
 * La app in-game (via Companion) manda periodicamente (heartbeat) o al
 * cerrar la sesion el total acumulado de metros recorridos en ESA sesion
 * segun distanceTraveled de la memoria compartida de AC.
 *
 * Guarda el valor tal cual (no suma): cada llamada manda el acumulado
 * completo de la sesion, asi que reintentos o llamadas fuera de orden no
 * duplican distancia. Un trigger en `sesion` recalcula piloto_auto.km_totales
 * a partir de esta columna.
 *
 * Body: { metros }
 */
router.put('/:id/distancia', autenticarPiloto, async (req, res) => {
  const { id } = req.params;
  const { metros } = req.body;

  if (typeof metros !== 'number' || metros < 0) {
    return res.status(400).json({ error: 'metros debe ser un numero mayor o igual a 0' });
  }

  try {
    const result = await pool.query(
      `update sesion set km_recorridos = $1 / 1000.0
       where id = $2 and piloto_id = $3
       returning id, km_recorridos`,
      [metros, id, req.piloto.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Sesión no encontrada o no pertenece a este piloto' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error actualizando distancia de sesión:', err);
    res.status(500).json({ error: 'Error interno actualizando distancia' });
  }
});

module.exports = router;
