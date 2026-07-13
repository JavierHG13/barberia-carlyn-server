import express from 'express';
import { body, param } from 'express-validator';
import BackupController from '../controllers/backup.controller.js';
import { verifyToken, requireRole } from '../middlewares/auth.middleware.js';
const router = express.Router();

// Todos los endpoints requieren autenticación y rol de admin
router.use(verifyToken, requireRole('Admin'));

// ==========================================
// GESTIÓN DE BACKUPS
// ==========================================
router.get('/recientes', BackupController.getRecent);
router.get('/estadisticas', BackupController.getStats);
router.get('/cloudinary/verificar', BackupController.verifyCloudinary);
router.post('/limpiar-expirados', BackupController.cleanExpired);

// 👇 CONFIGURACION AQUÍ ARRIBA
router.get('/configuracion', BackupController.getConfigs);
router.post('/configuracion', BackupController.createConfig);
router.put('/configuracion/:id', BackupController.updateConfig);
router.put('/configuracion/:id/toggle', BackupController.toggleConfig);
router.delete('/configuracion/:id', BackupController.deleteConfig);

// =============================
// DESPUÉS LAS GENERALES
// =============================

router.get('/', BackupController.getAll);
router.post('/manual', BackupController.createManual);
router.get('/tablas', BackupController.listAllTables);

// ⚠️ ESTA SIEMPRE AL FINAL
router.get('/:id', BackupController.getById);
router.delete('/:id', BackupController.delete);

export default router;