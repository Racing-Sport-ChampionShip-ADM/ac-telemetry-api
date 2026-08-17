const express = require('express');
const pool = require('../db/pool');
const { autenticarRaceControl } = require('../middleware/auth');
const { obtenerOCrearAuto, obtenerOCrearCircuito } = require('../db/catalogos');

const router = express.Router();

/**
 * POST /api/race-control/resultados
 * RaceControl (tu servidor dedicado de liga) reporta el resultado de una carrera oficial.
 * Requiere que el piloto ya exista (matcheado por steam_id).
 *
 * Body:
 * {
 *   steam_id,
 *   auto: { nombre_interno, ... },
 *   circuito: { nombre_interno, layout?, ... },
 *   fecha_inicio, fecha_fin,
 *   vueltas: [{ numero_vuelta, tiempo_ms, valida }, ...]
 * }
 */
router.post('/resultados', autenticarRaceControl, async (req, res) => {
  const { steam_id, auto, circuito, fecha_inicio, fecha_fin, vueltas } = req.body;

  if (!steam_id || !auto?.nombre_interno || !circuito?.nombre_interno || !Array.isArray(vueltas)) {
    return res.status(400).json({ error: 'steam_id, auto, circuito y vueltas son requeridos' });
  }

  const client = await pool.connect();
  try {
    await client.query('begin');

    const piloto = await client.query('select id from piloto where steam_id = $1', [steam_id]);
    if (piloto.rows.length === 0) {
      await client.query('rollback');
      return res.status(404).json({ error: 'No existe un piloto registrado con ese steam_id' });
    }
    const pilotoId = piloto.rows[0].id;

    const autoId = await obtenerOCrearAuto(auto);
    const circuitoId = await obtenerOCrearCircuito(circuito);

    const sesion = await client.query(
      `insert into sesion (piloto_id, auto_id, circuito_id, fecha_inicio, fecha_fin, origen)
       values ($1, $2, $3, $4, $5, 'race_control')
       returning id`,
      [pilotoId, autoId, circuitoId, fecha_inicio || new Date().toISOString(), fecha_fin || null]
    );
    const sesionId = sesion.rows[0].id;

    for (const v of vueltas) {
      await client.query(
        `insert into vuelta (sesion_id, numero_vuelta, tiempo_ms, valida, fecha)
         values ($1, $2, $3, coalesce($4, true), coalesce($5, now()))`,
        [sesionId, v.numero_vuelta, v.tiempo_ms, v.valida, v.fecha || null]
      );
    }

    await client.query('commit');
    res.status(201).json({ sesion_id: sesionId, vueltas_registradas: vueltas.length });
  } catch (err) {
    await client.query('rollback');
    console.error('Error registrando resultados de RaceControl:', err);
    res.status(500).json({ error: 'Error interno registrando resultados' });
  } finally {
    client.release();
  }
});

module.exports = router;
