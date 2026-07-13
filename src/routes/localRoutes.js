import { Router } from 'express';
import {
  listarLocales, getLocalById, crearLocal, actualizarLocal, desactivarLocal,
} from '../controllers/localController.js';

const router = Router();

router.get('/', listarLocales);
router.get('/:id', getLocalById);
router.post('/', crearLocal);          // agrega tu middleware de admin aquí
router.put('/:id', actualizarLocal);   // agrega tu middleware de admin aquí
router.delete('/:id', desactivarLocal);// agrega tu middleware de admin aquí

export default router;