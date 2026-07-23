import { Router } from 'express';
import {
  listarLocales, getLocalById, crearLocal, actualizarLocal, desactivarLocal,
} from '../controllers/localController.js';
import { requireRole, verifyToken } from '../middlewares/auth.middleware.js';

const router = Router();

router.get('/', listarLocales);
router.get('/:id', getLocalById);
router.post('/', verifyToken, requireRole('Admin'), crearLocal);
router.put('/:id', verifyToken, requireRole('Admin'), actualizarLocal);
router.delete('/:id', verifyToken, requireRole('Admin'), desactivarLocal);

export default router;
