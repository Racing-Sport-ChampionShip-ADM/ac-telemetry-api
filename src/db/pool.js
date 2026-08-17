const { Pool } = require('pg');

// DATABASE_URL viene de Supabase: Project Settings > Database > Connection string (URI)
// Usar la "Connection pooling" string (puerto 6543) si está disponible, ideal para
// backends serverless/con reinicios frecuentes como Render free tier.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

pool.on('error', (err) => {
  console.error('Error inesperado en el pool de Postgres', err);
});

module.exports = pool;
