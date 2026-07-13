import express from 'express';
import session from 'express-session';
import cors from 'cors';
import dotenv from 'dotenv';
import authRoutes from './routes/authRoutes.js';
import usuarioRoutes from './routes/usuarios.routes.js';
import appointmentRoutes from './routes/appointmentRoutes.js';
import databaseRoutes from './routes/database.routes.js'
import backupRoutes from './routes/backup.routes.js'
import productsRoutes from './routes/productsRoutes.js'
import statsRoutes from './routes/statsRoutes.js';
import barberosRoutes from './routes/barberoRoutes.js'
import serviciosRoutes from './routes/servicios.routes.js'
import vacuumRoutes from './routes/vacuum.routes.js';
import prediccionRoute from './routes/prediccion.routes.js'
import oauthRoutes from './routes/oauth.routes.js';
import localesRoutes from './routes/localRoutes.js';
import logger from './config/logger.js';
import { httpLogger } from './middlewares/loggerMiddleware.js';
import { initBackupScheduler } from './config/backup.scheduler.js';
import { appSensor } from './middlewares/appSensor.js';


dotenv.config();

const app = express();

const allowedOrigins = [
  'https://barberia-carlyn.netlify.app',
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:4200',
  'https://localhost:4200',
];

// Middlewares
app.use(cors({
  origin: function (origin, callback) {

    // permite requests sin origin (postman, mobile apps)
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    callback(new Error('No permitido por CORS'));
  },
  credentials: true,
}));

app.use(httpLogger);
app.use(express.json());
app.use(appSensor); 
app.use(express.urlencoded({ extended: true }));

const backupScheduler = initBackupScheduler();

process.on('SIGTERM', () => backupScheduler.stop());
process.on('SIGINT',  () => backupScheduler.stop());
// Sesiones
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000,
  },
}));

// Rutas
app.use('/api/auth', authRoutes);
app.use('/api/admin/usuarios', usuarioRoutes);
app.use('/api/citas', appointmentRoutes);
app.use('/api/servicios', serviciosRoutes);
app.use('/api/barbero', barberosRoutes);
app.use('/api/admin/database', databaseRoutes);
app.use('/api/admin/backups', backupRoutes);
app.use('/api/admin/vacuums', vacuumRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/productos',  productsRoutes);
app.use('/api/prediccion',  prediccionRoute);
app.use('/api/locales', localesRoutes);
app.use('/oauth', oauthRoutes);

app.get('/health', (req, res) => {
  logger.info('Health check');
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.get('/', (req, res) => {
  logger.info('Ruta raíz accedida');
  res.status(200).json({
    ok: true,
    message: 'El servidor está corriendo correctamente'
  });
});

// Manejo de errores
app.use((err, req, res, next) => {
  logger.error(err.message);

  const statusCode = err.statusCode || 500;
  const message = err.message || 'Error interno del servidor';

  res.status(statusCode).json({ message });
});

export default app;
