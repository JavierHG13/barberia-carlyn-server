import { Router } from 'express';
import {
  registerSale,
  getSalesHistoryByDay,
  generateCashCut,
} from '../controllers/saleController.js';
import { requireRole, verifyToken } from '../middlewares/auth.middleware.js';

const router = Router();

router.use(verifyToken, requireRole('Admin'));

router.get('/ventas', getSalesHistoryByDay);
router.post('/ventas', registerSale);
router.post('/ventas/corte-caja', generateCashCut);

export default router;
