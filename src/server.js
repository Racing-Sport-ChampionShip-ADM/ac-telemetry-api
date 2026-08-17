require('dotenv').config();
const express = require('express');
const cors = require('cors');

const authRouter = require('./routes/auth');
const pilotosRouter = require('./routes/pilotos');
const sesionesRouter = require('./routes/sesiones');
const vueltasRouter = require('./routes/vueltas');
const setupsRouter = require('./routes/setups');
const raceControlRouter = require('./routes/raceControl');

const app = express();

app.use(cors()); // en producción, restringir a tu dominio del frontend (ver README)
app.use(express.json({ limit: '2mb' })); // setups pueden ser JSON grandes

app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'ac-telemetry-api' });
});

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

app.use('/api/auth', authRouter);
app.use('/api/pilotos', pilotosRouter);
app.use('/api/sesiones', sesionesRouter);
app.use('/api/vueltas', vueltasRouter);
app.use('/api/setups', setupsRouter);
app.use('/api/race-control', raceControlRouter);

// 404 genérico
app.use((req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada' });
});

// Manejador de errores genérico (por si algo no capturado escapa de una ruta)
app.use((err, req, res, next) => {
  console.error('Error no manejado:', err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`AC Telemetry API corriendo en puerto ${PORT}`);
});
