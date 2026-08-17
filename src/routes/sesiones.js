const express = require('express');
const pool = require('../db/pool');
const { autenticarPiloto } = require('../middleware/auth');
const { obtenerOCrearAuto, obtenerOCrearCircuito } = require('../db/catalogos');

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

module.exports = router;
