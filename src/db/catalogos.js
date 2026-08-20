const pool = require('./pool');

/**
 * Busca un auto por nombre_interno. Si no existe, lo crea.
 * Devuelve el id del auto.
 */
async function obtenerOCrearAuto({ nombre_interno, nombre_visible, marca, categoria }) {
  if (!nombre_interno) throw new Error('nombre_interno de auto es requerido');

  const existente = await pool.query(
    'select id, nombre_visible, marca from auto where nombre_interno = $1',
    [nombre_interno]
  );
  if (existente.rows.length > 0) {
    const autoId = existente.rows[0].id;
    // Autocorrige autos viejos: si el nombre_visible guardado es el
    // placeholder (igual al nombre_interno) o esta vacio, y ahora nos
    // llega un nombre_visible real (leido de ui_car.json), lo
    // actualizamos. Mismo patron que la autocorreccion de
    // longitud_metros en obtenerOCrearCircuito.
    const nombreVisibleDesactualizado =
      !existente.rows[0].nombre_visible || existente.rows[0].nombre_visible === nombre_interno;
    if (nombreVisibleDesactualizado && nombre_visible && nombre_visible !== nombre_interno) {
      await pool.query('update auto set nombre_visible = $1 where id = $2', [nombre_visible, autoId]);
    }
    if (!existente.rows[0].marca && marca) {
      await pool.query('update auto set marca = $1 where id = $2', [marca, autoId]);
    }
    return autoId;
  }

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
    'select id, longitud_metros from circuito where nombre_interno = $1 and layout = $2',
    [nombre_interno, layoutNormalizado]
  );
  if (existente.rows.length > 0) {
    const circuitoId = existente.rows[0].id;
    // Autocorrige circuitos viejos que se crearon sin longitud_metros
    // (ej. antes de que la app in-game empezara a mandarlo). No pisa un
    // valor ya cargado por otro dato posiblemente distinto.
    if (existente.rows[0].longitud_metros == null && longitud_metros) {
      await pool.query('update circuito set longitud_metros = $1 where id = $2', [
        longitud_metros,
        circuitoId,
      ]);
    }
    return circuitoId;
  }

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
