import {
  registerSale,
  getSalesHistoryByDay,
  generateCashCut,
} from '../controllers/saleController.js';

//ventas POS
router.post('/ventas', validateRegisterSale, registerSale);
router.post('/ventas/corte-caja', validateGenerateCashCut, generateCashCut);
