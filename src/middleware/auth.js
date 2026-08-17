const pool = require('../db/pool');

/**
 * Middleware que autentica al piloto vía header:
 *   Authorization: Bearer <api_key>
 *
 * Si es válido, agrega req.piloto = { id, nombre_piloto, numero_piloto, ... }
 */
async function autenticarPiloto(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const [tipo, apiKey] = authHeader.split(' ');

  if (tipo !== 'Bearer' || !apiKey) {
    return res.status(401).json({ error: 'Falta el header Authorization: Bearer <api_key>' });
  }

  try {
    const result = await pool.query(
      'select id, nombre_piloto, numero_piloto, steam_id from piloto where api_key = $1',
      [apiKey]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'api_key inválida' });
    }

    req.piloto = result.rows[0];
    next();
  } catch (err) {
    console.error('Error autenticando piloto:', err);
    res.status(500).json({ error: 'Error interno de autenticación' });
  }
}

/**
 * Middleware simple para proteger el endpoint que usa RaceControl (servidor dedicado),
 * distinto del api_key de piloto. Usa una clave fija por variable de entorno.
 */
function autenticarRaceControl(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const [tipo, token] = authHeader.split(' ');

  if (tipo !== 'Bearer' || token !== process.env.RACE_CONTROL_TOKEN) {
    return res.status(401).json({ error: 'Token de RaceControl inválido' });
  }

  next();
}

module.exports = { autenticarPiloto, autenticarRaceControl };
