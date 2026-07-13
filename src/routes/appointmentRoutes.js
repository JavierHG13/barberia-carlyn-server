import { Router } from 'express';
import {
  createAppointment,
  updateAppointment,
  getAllAppointments,
  getAppointmentById,
  cancelAppointment,
  completeAppointment,
  searchAppointments,
  getUpcomingAppointments,
  getAppointmentsCalendar,
  markNoShowAppointments,
  getAvailableSlots,
  getAvailableDates
} from '../controllers/appointmentController.js';

import { verifyToken, requireRole } from '../middlewares/auth.middleware.js';

const router = Router();

/* Middleware global */
router.use(verifyToken);


// Crear cita
router.post('/',
  requireRole('Cliente', 'Barbero', 'Admin'),
  createAppointment
);

// Listar citas
router.get('/',
  requireRole('Cliente', 'Barbero', 'Admin'),
  getAllAppointments
);

//Buscar espacios disponibles
// GET /api/citas/fechas-disponibles
router.get('/fechas-disponibles', 
  requireRole('Cliente', 'Barbero', 'Admin'),
  getAvailableDates
);

// GET /api/citas/horarios-disponibles
router.get('/horarios-disponibles', 
  requireRole('Cliente', 'Barbero', 'Admin'),
  getAvailableSlots
);
// Buscar
router.get('/search',
  requireRole('Barbero', 'Admin'),
  searchAppointments
);

// Próximas
router.get('/proximas',
  requireRole('Barbero', 'Admin'),
  getUpcomingAppointments
);

// Calendario
router.get('/calendario',
  requireRole('barbero', 'admin'),
  getAppointmentsCalendar
);

// No asistió
router.post('/mark-no-show',
  requireRole('Admin'),
  markNoShowAppointments
);

// Obtener cita
router.get('/:id',
  requireRole('Cliente', 'Barbero', 'Admin'),
  getAppointmentById
);

// Editar
router.put('/:id',
  requireRole('Barbero', 'Admin'),
  updateAppointment
);

// Cancelar
router.delete('/:id',
  requireRole('Cliente', 'Barbero', 'Admin'),
  cancelAppointment
);

// Completar
router.put('/:id/completar',
  requireRole('Barbero', 'Admin'),
  completeAppointment
);



export default router;