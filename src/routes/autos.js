const express = require('express');
const pool = require('../db/pool');
const { autenticarPiloto } = require('../middleware/auth');
const { obtenerOCrearAuto } = require('../db/catalogos');
const { subirImagenAuto } = require('../storage/supabaseStorage');

const router = express.Router();

/**
 * POST /api/autos/imagen
 * La app in-game manda la preview.jpg de alguna skin del auto
 * (codificada en base64, leída de su propia carpeta de contenido de
 * AC) la primera vez que lo detecta. Se sube a Supabase Storage y se
 * guarda la URL pública en el auto correspondiente. Si el auto ya
 * tiene imagen, no se vuelve a subir.
 *
 * Body:
 * {
 *   auto: { nombre_interno, nombre_visible?, marca?, categoria? },
 *   imagen_base64: "<jpg codificado en base64, sin el prefijo data:...>"
 * }
 */
router.post('/imagen', autenticarPiloto, async (req, res) => {
  const { auto, imagen_base64 } = req.body;

  if (!auto?.nombre_interno || !imagen_base64) {
    return res.status(400).json({ error: 'auto.nombre_interno e imagen_base64 son requeridos' });
  }

  try {
    const autoId = await obtenerOCrearAuto(auto);

    const actual = await pool.query('select imagen_url from auto where id = $1', [autoId]);
    if (actual.rows[0]?.imagen_url) {
      return res.json({ auto_id: autoId, imagen_url: actual.rows[0].imagen_url, ya_existia: true });
    }

    const buffer = Buffer.from(imagen_base64, 'base64');
    const imagenUrl = await subirImagenAuto(autoId, buffer);

    await pool.query('update auto set imagen_url = $1 where id = $2', [imagenUrl, autoId]);

    res.json({ auto_id: autoId, imagen_url: imagenUrl, ya_existia: false });
  } catch (err) {
    console.error('Error subiendo imagen de auto:', err);
    res.status(500).json({ error: 'Error interno subiendo imagen de auto' });
  }
});

module.exports = router;
