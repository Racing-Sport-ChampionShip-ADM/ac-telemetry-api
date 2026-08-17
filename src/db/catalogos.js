const pool = require('./pool');

/**
 * Busca un auto por nombre_interno. Si no existe, lo crea.
 * Devuelve el id del auto.
 */
async function obtenerOCrearAuto({ nombre_interno, nombre_visible, marca, categoria }) {
  if (!nombre_interno) throw new Error('nombre_interno de auto es requerido');

  const existente = await pool.query('select id from auto where nombre_interno = $1', [nombre_interno]);
  if (existente.rows.length > 0) return existente.rows[0].id;

  const creado = await pool.query(
    `insert into auto (nombre_interno, nombre_visible, marca, categoria)
     values ($1, $2, $3, $4)
     on conflict (nombre_interno) do update set nombre_interno = excluded.nombre_interno
     returning id`,
    [nombre_interno, nombre_visible || null, marca || null, categoria || null]
  );
  return creado.rows[0].id;
}

/**
 * Busca un circuito por (nombre_interno, layout). Si no existe, lo crea.
 * Devuelve el id del circuito.
 */
async function obtenerOCrearCircuito({ nombre_interno, layout, nombre_visible, longitud_metros }) {
  if (!nombre_interno) throw new Error('nombre_interno de circuito es requerido');
  const layoutNormalizado = layout || 'default';

  const existente = await pool.query(
    'select id from circuito where nombre_interno = $1 and layout = $2',
    [nombre_interno, layoutNormalizado]
  );
  if (existente.rows.length > 0) return existente.rows[0].id;

  const creado = await pool.query(
    `insert into circuito (nombre_interno, layout, nombre_visible, longitud_metros)
     values ($1, $2, $3, $4)
     on conflict (nombre_interno, layout) do update set nombre_interno = excluded.nombre_interno
     returning id`,
    [nombre_interno, layoutNormalizado, nombre_visible || null, longitud_metros || null]
  );
  return creado.rows[0].id;
}

module.exports = { obtenerOCrearAuto, obtenerOCrearCircuito };
