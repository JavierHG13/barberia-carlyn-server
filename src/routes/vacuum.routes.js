import express from 'express';
import VacuumController from '../controllers/vacuum.controller.js';
import { verifyToken, requireRole } from '../middlewares/auth.middleware.js';

const router = express.Router();
router.use(verifyToken, requireRole('Admin'));

// Configuraciones (siempre antes de /:id)
router.get('/configuracion',             VacuumController.getConfigs);

router.post('/configuracion',            VacuumController.createConfig);

router.put('/configuracion/:id',         VacuumController.updateConfig);
router.put('/configuracion/:id/toggle',  VacuumController.toggleConfig);
router.delete('/configuracion/:id',      VacuumController.deleteConfig);

// Ejecuciones
router.post('/manual',   VacuumController.runManual);
router.get('/',          VacuumController.getAll);
router.get('/:id',       VacuumController.getById);
router.delete('/:id',    VacuumController.delete);

export default router;