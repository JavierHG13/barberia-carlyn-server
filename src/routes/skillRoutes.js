import { Router } from 'express';
import { verifyToken } from '../middlewares/auth.middleware.js';
import { verifySkillKey } from '../middlewares/skillAuth.middleware.js';
import {
  cancelSkillAppointment,
  confirmAlexaLink,
  createSkillAppointment,
  getAlexaLinkStatus,
  getSkillAppointments,
  getSkillAvailableDates,
  getSkillAvailableSlots,
  startAlexaLink,
  unlinkAlexaAccount,
} from '../controllers/skillController.js';

const router = Router();

router.post('/link/start', verifySkillKey, startAlexaLink);
router.get('/link/status', verifySkillKey, getAlexaLinkStatus);

router.post('/link/confirm', verifyToken, confirmAlexaLink);
router.delete('/link', verifyToken, unlinkAlexaAccount);

router.get('/citas', verifySkillKey, getSkillAppointments);
router.post('/citas', verifySkillKey, createSkillAppointment);
router.delete('/citas/:id', verifySkillKey, cancelSkillAppointment);
router.get('/fechas-disponibles', verifySkillKey, getSkillAvailableDates);
router.get('/horarios-disponibles', verifySkillKey, getSkillAvailableSlots);

export default router;
