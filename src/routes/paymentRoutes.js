import { Router } from 'express';
import {
  createAppointmentPreference,
  createExistingAppointmentPreference,
  confirmAppointmentPayment,
} from '../controllers/paymentController.js';
import { verifyToken, requireRole } from '../middlewares/auth.middleware.js';

const router = Router();

router.use(verifyToken);

router.post(
  '/appointments/preference',
  //requireRole('Cliente', 'Admin'),
  createAppointmentPreference
);

router.post(
  '/appointments/:id/preference',
  requireRole('Cliente', 'Admin'),
  createExistingAppointmentPreference
);

router.post(
  '/appointments/confirm',
  requireRole('Cliente', 'Admin'),
  confirmAppointmentPayment
);

export default router;
