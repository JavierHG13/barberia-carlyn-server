import { Router } from 'express';
import { verifyToken, requireRole } from '../middlewares/auth.middleware.js';
import { calcularPrediccion, getResumenPrediccion, getMesesDisponibles, getCitasPorMes} from '../controllers/prediccionController.js';

const router = Router();

// Todas las rutas requieren autenticación y rol de admin
router.use(verifyToken, requireRole('Admin'));

// GET /api/prediccion/resumen - Obtener resumen de datos históricos
router.get('/resumen', getResumenPrediccion);

// POST /api/prediccion - Calcular predicción para fecha objetivo
router.post('/', calcularPrediccion);

router.get('/meses-disponibles', getMesesDisponibles);

router.get('/citas', getCitasPorMes);

export default router;