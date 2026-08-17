const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../db/pool');

const router = express.Router();

/**
 * POST /api/auth/login
 * Usado por la Companion App (login con email + contraseña).
 * Body: { email, password }
 *
 * Devuelve { token, piloto }. El "token" es la api_key existente del
 * piloto: así la Companion queda autenticada con el mismo mecanismo
 * (Authorization: Bearer <api_key>) que ya usan todos los demás
 * endpoints (sesiones, vueltas, setups), sin duplicar lógica de auth.
 */
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'email y password son requeridos' });
  }

  try {
    const result = await pool.query(
      `select id, nombre_piloto, numero_piloto, email, api_key, password_hash
       from piloto
       where email = $1`,
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Email o contraseña incorrectos' });
    }

    const piloto = result.rows[0];

    if (!piloto.password_hash) {
      // Piloto viejo, registrado antes de que existiera password (si aplica)
      return res.status(401).json({ error: 'Esta cuenta no tiene contraseña configurada' });
    }

    const passwordOk = await bcrypt.compare(password, piloto.password_hash);
    if (!passwordOk) {
      return res.status(401).json({ error: 'Email o contraseña incorrectos' });
    }

    res.json({
      token: piloto.api_key,
      piloto: {
        nombre_piloto: piloto.nombre_piloto,
        numero_piloto: piloto.numero_piloto,
      },
    });
  } catch (err) {
    console.error('Error en login:', err);
    res.status(500).json({ error: 'Error interno en login' });
  }
});

module.exports = router;
