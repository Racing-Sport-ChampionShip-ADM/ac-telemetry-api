const express = require('express');
const pool = require('../db/pool');
const { autenticarPiloto } = require('../middleware/auth');

const router = express.Router();

/**
 * POST /api/vueltas
 * Registra una vuelta completada. Dispara automáticamente (vía trigger SQL)
 * la actualización de km_totales y vueltas_totales en piloto_auto.
 *
 * Body: { sesion_id, numero_vuelta, tiempo_ms, valida? (default true), fecha? }
 */
router.post('/', autenticarPiloto, async (req, res) => {
  const { sesion_id, numero_vuelta, tiempo_ms, valida, fecha } = req.body;

  if (!sesion_id || !numero_vuelta || !tiempo_ms) {
    return res.status(400).json({ error: 'sesion_id, numero_vuelta y tiempo_ms son requeridos' });
  }

  try {
    // Verificar que la sesión pertenezca al piloto autenticado
    const sesion = await pool.query('select id from sesion where id = $1 and piloto_id = $2', [
      sesion_id,
      req.piloto.id,
    ]);
    if (sesion.rows.length === 0) {
      return res.status(404).json({ error: 'Sesión no encontrada o no pertenece a este piloto' });
    }

    const result = await pool.query(
      `insert into vuelta (sesion_id, numero_vuelta, tiempo_ms, valida, fecha)
       values ($1, $2, $3, coalesce($4, true), coalesce($5, now()))
       returning id, numero_vuelta, tiempo_ms, valida, fecha`,
      [sesion_id, numero_vuelta, tiempo_ms, valida, fecha || null]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creando vuelta:', err);
    res.status(500).json({ error: 'Error interno registrando vuelta' });
  }
});

/**
 * POST /api/vueltas/batch
 * Igual que arriba pero para mandar varias vueltas juntas (útil si la app in-game
 * bufferea vueltas por falta de internet momentánea y las reintenta).
 * Body: { vueltas: [{ sesion_id, numero_vuelta, tiempo_ms, valida?, fecha? }, ...] }
 */
router.post('/batch', autenticarPiloto, async (req, res) => {
  const { vueltas } = req.body;

  if (!Array.isArray(vueltas) || vueltas.length === 0) {
    return res.status(400).json({ error: 'vueltas debe ser un array no vacío' });
  }

  const client = await pool.connect();
  try {
    await client.query('begin');

    const insertadas = [];
    for (const v of vueltas) {
      const sesion = await client.query('select id from sesion where id = $1 and piloto_id = $2', [
        v.sesion_id,
        req.piloto.id,
      ]);
      if (sesion.rows.length === 0) continue; // salteamos vueltas de sesiones que no son de este piloto

      const result = await client.query(
        `insert into vuelta (sesion_id, numero_vuelta, tiempo_ms, valida, fecha)
         values ($1, $2, $3, coalesce($4, true), coalesce($5, now()))
         returning id, numero_vuelta, tiempo_ms, valida, fecha`,
        [v.sesion_id, v.numero_vuelta, v.tiempo_ms, v.valida, v.fecha || null]
      );
      insertadas.push(result.rows[0]);
    }

    await client.query('commit');
    res.status(201).json({ insertadas });
  } catch (err) {
    await client.query('rollback');
    console.error('Error en batch de vueltas:', err);
    res.status(500).json({ error: 'Error interno en batch de vueltas' });
  } finally {
    client.release();
  }
});

module.exports = router;
