import { Router } from 'express';
import { verifyToken, requireRole } from '../middlewares/auth.middleware.js';
import {
  calcularPrediccion,
  entrenarKnowledgeModels,
  getCitasPorMes,
  getKnowledgeModule,
  getMesesDisponibles,
  getResumenPrediccion,
} from '../controllers/prediccionController.js';

const router = Router();

// Todas las rutas requieren autenticación y rol de admin
router.use(verifyToken, requireRole('Admin'));

// GET /api/prediccion/resumen - Obtener resumen de datos históricos
router.get('/resumen', getResumenPrediccion);

// POST /api/prediccion - Calcular predicción para fecha objetivo
router.post('/', calcularPrediccion);

router.get('/meses-disponibles', getMesesDisponibles);

router.get('/citas', getCitasPorMes);

router.get('/conocimiento/:tipo', getKnowledgeModule);

router.post('/conocimiento/entrenar', entrenarKnowledgeModels);

export default router;
