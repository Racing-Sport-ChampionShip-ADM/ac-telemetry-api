const express = require('express');
const pool = require('../db/pool');
const { autenticarPiloto } = require('../middleware/auth');
const { obtenerOCrearCircuito } = require('../db/catalogos');
const { subirImagenCircuito } = require('../storage/supabaseStorage');

const router = express.Router();

/**
 * POST /api/circuitos/imagen
 * La app in-game manda la preview.png del circuito (codificada en base64,
 * leída de su propia carpeta de contenido de AC) la primera vez que lo
 * detecta. Se sube a Supabase Storage y se guarda la URL pública en el
 * circuito correspondiente. Si el circuito ya tiene imagen, no se
 * vuelve a subir (evita trabajo repetido cada vez que el piloto entra
 * a ese circuito).
 *
 * Body:
 * {
 *   circuito: { nombre_interno, layout?, nombre_visible?, longitud_metros? },
 *   imagen_base64: "<png codificado en base64, sin el prefijo data:...>"
 * }
 */
router.post('/imagen', autenticarPiloto, async (req, res) => {
  const { circuito, imagen_base64 } = req.body;

  if (!circuito?.nombre_interno || !imagen_base64) {
    return res.status(400).json({ error: 'circuito.nombre_interno e imagen_base64 son requeridos' });
  }

  try {
    const circuitoId = await obtenerOCrearCircuito(circuito);

    const actual = await pool.query('select imagen_url from circuito where id = $1', [circuitoId]);
    if (actual.rows[0]?.imagen_url) {
      // Ya tiene imagen, no hace falta volver a subirla.
      return res.json({ circuito_id: circuitoId, imagen_url: actual.rows[0].imagen_url, ya_existia: true });
    }

    const buffer = Buffer.from(imagen_base64, 'base64');
    const imagenUrl = await subirImagenCircuito(circuitoId, buffer);

    await pool.query('update circuito set imagen_url = $1 where id = $2', [imagenUrl, circuitoId]);

    res.json({ circuito_id: circuitoId, imagen_url: imagenUrl, ya_existia: false });
  } catch (err) {
    console.error('Error subiendo imagen de circuito:', err);
    res.status(500).json({ error: 'Error interno subiendo imagen de circuito' });
  }
});

module.exports = router;
