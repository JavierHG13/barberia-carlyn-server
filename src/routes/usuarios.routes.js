import express from 'express';
import UsuarioController from '../controllers/usuario.controller.js';
import { verifyToken, requireRole } from '../middlewares/auth.middleware.js';

const router = express.Router();

/* =====================================
   Middleware global (solo admin)
===================================== */
router.use(verifyToken, requireRole('Admin'));

/* =====================================
   CRUD USUARIOS
===================================== */

// GET /api/admin/usuarios
router.get('/', UsuarioController.getAll);

// GET /api/admin/usuarios/:id
router.get('/:id', UsuarioController.getById);

// POST /api/admin/usuarios
router.post('/', UsuarioController.create);

// PUT /api/admin/usuarios/:id
router.put('/:id', UsuarioController.update);

// DELETE /api/admin/usuarios/:id
router.delete('/:id', UsuarioController.delete);

/* =====================================
   ACCIONES ESPECIALES
===================================== */
router.put('/:id/activar', UsuarioController.activate);


router.post('/:id/convertir-barbero', UsuarioController.convertToBarbero);


router.get('/estadisticas/generales', UsuarioController.getGeneralStats);

export default router;