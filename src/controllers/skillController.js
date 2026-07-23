import Appointment from '../models/appointment.js';
import BarberoModel from '../models/barbero.js';
import AlexaLink from '../models/alexaLink.model.js';
import { pool, query } from '../config/database.js';
import emailService from '../utils/emailService.js';

const CANCELLED_ESTADO_IDS = [4];
const APPOINTMENT_DURATION_MINUTES = 30;
const APPOINTMENT_BREAK_MINUTES = 10;

const parsePositiveInt = (value) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) || parsed <= 0 ? null : parsed;
};

const parseTimeValue = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return /^\d{2}:\d{2}(:\d{2})?$/.test(trimmed) ? trimmed : null;
};

const addMinutesToTime = (timeStr, minutes) => {
  const parsed = parseTimeValue(timeStr);
  if (!parsed) return null;
  const [h, m] = parsed.split(':').map(Number);
  const totalMinutes = h * 60 + m + minutes;
  const hh = String(Math.floor(totalMinutes / 60) % 24).padStart(2, '0');
  const mm = String(totalMinutes % 60).padStart(2, '0');
  return `${hh}:${mm}:00`;
};

const getAlexaUserId = (req) => req.body?.alexaUserId || req.query?.alexaUserId;

const resolveLinkedUser = async (req, res) => {
  const linkedUser = await AlexaLink.findLinkedUser(getAlexaUserId(req));
  if (!linkedUser) {
    res.status(401).json({
      linked: false,
      message: 'La cuenta de Alexa no está vinculada con un cliente',
    });
    return null;
  }

  return linkedUser;
};

export const startAlexaLink = async (req, res, next) => {
  try {
    const linkedUser = await AlexaLink.findLinkedUser(req.body.alexaUserId);
    if (linkedUser) {
      return res.json({
        linked: true,
        user: {
          id: linkedUser.usuario_id,
          nombre: linkedUser.nombre,
          email: linkedUser.email,
        },
      });
    }

    const pairingCode = await AlexaLink.createPairingCode(req.body.alexaUserId);
    res.json({
      linked: false,
      code: pairingCode.code,
      expiresAt: pairingCode.expires_at,
      linkUrl: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/alexa/vincular`,
    });
  } catch (error) {
    next(error);
  }
};

export const getAlexaLinkStatus = async (req, res, next) => {
  try {
    const linkedUser = await AlexaLink.findLinkedUser(req.query.alexaUserId);
    res.json({
      linked: Boolean(linkedUser),
      user: linkedUser
        ? {
            id: linkedUser.usuario_id,
            nombre: linkedUser.nombre,
            email: linkedUser.email,
          }
        : null,
    });
  } catch (error) {
    next(error);
  }
};

export const confirmAlexaLink = async (req, res, next) => {
  try {
    const linked = await AlexaLink.confirmPairingCode(req.body.code, req.user.id);
    res.json({
      message: 'Cuenta vinculada correctamente con Alexa',
      data: linked,
    });
  } catch (error) {
    next(error);
  }
};

export const unlinkAlexaAccount = async (req, res, next) => {
  try {
    await AlexaLink.unlinkByUser(req.user.id);
    res.json({ message: 'Cuenta de Alexa desvinculada correctamente' });
  } catch (error) {
    next(error);
  }
};

export const getSkillAppointments = async (req, res, next) => {
  try {
    const linkedUser = await resolveLinkedUser(req, res);
    if (!linkedUser) return;

    const citas = await Appointment.findAll({
      userRole: 'Cliente',
      userId: linkedUser.usuario_id,
    });

    res.json({ message: 'Citas obtenidas correctamente', data: citas, total: citas.length });
  } catch (error) {
    next(error);
  }
};

export const createSkillAppointment = async (req, res, next) => {
  try {
    const linkedUser = await resolveLinkedUser(req, res);
    if (!linkedUser) return;

    const barberoId = parsePositiveInt(req.body.barberoId);
    const servicioId = parsePositiveInt(req.body.servicioId);
    const localId = parsePositiveInt(req.body.localId);
    const estadoId = parsePositiveInt(req.body.estadoId) || 1;
    const { fecha } = req.body;
    const horaInicio = parseTimeValue(req.body.horaInicio);

    if (!barberoId) return res.status(400).json({ message: 'barberoId inválido' });
    if (!servicioId) return res.status(400).json({ message: 'servicioId inválido' });
    if (!fecha || Number.isNaN(new Date(fecha).getTime())) return res.status(400).json({ message: 'fecha inválida' });
    if (!horaInicio) return res.status(400).json({ message: 'horaInicio inválida' });

    const barbero = await BarberoModel.getById(barberoId);
    if (!barbero || !barbero.activo) {
      return res.status(404).json({ message: 'Barbero no encontrado o inactivo' });
    }
    if (localId && barbero.local_id && localId !== barbero.local_id) {
      return res.status(409).json({ message: `Este barbero pertenece a "${barbero.local_nombre}"` });
    }

    const horaFin = addMinutesToTime(horaInicio, APPOINTMENT_DURATION_MINUTES);
    const conflict = await Appointment.hasConflict({
      barberoId,
      fecha,
      horaInicio,
      horaFin,
      breakMinutes: APPOINTMENT_BREAK_MINUTES,
      cancelledEstadoIds: CANCELLED_ESTADO_IDS,
    });

    if (conflict) {
      return res.status(409).json({
        message: `Ya existe una cita en ese horario. Debe haber ${APPOINTMENT_BREAK_MINUTES} minutos de descanso entre citas`,
      });
    }

    const appointment = await Appointment.create({
      clienteId: linkedUser.usuario_id,
      barberoId,
      servicioId,
      localId: localId || barbero.local_id || null,
      fecha,
      horaInicio,
      horaFin,
      estadoId,
      notas: 'Cita creada desde Alexa - Pendiente de anticipo',
      montoPagado: null,
    });

    await query(
      `INSERT INTO notificaciones (usuario_id, cita_id, tipo, mensaje)
       VALUES ($1, $2, 'confirmacion', $3)`,
      [
        linkedUser.usuario_id,
        appointment.id,
        `Tu cita fue apartada desde Alexa para el ${fecha} a las ${horaInicio}. Paga el anticipo para confirmarla.`,
      ]
    ).catch((err) => console.error('Error al crear notificación Alexa:', err));

    const total = Number(appointment.servicio_precio || 0);
    const depositAmount = Number((total * 0.5).toFixed(2));
    const remainingAmount = Number((total - depositAmount).toFixed(2));

    emailService.sendAppointmentDepositPendingEmail(
      appointment.cliente_email || linkedUser.email,
      appointment.cliente_nombre || linkedUser.nombre,
      appointment,
      { depositAmount, remainingAmount }
    ).catch((err) => console.error('Error al enviar correo de anticipo pendiente:', err.message));

    res.status(201).json({
      message: 'Cita apartada correctamente. Requiere pago de anticipo.',
      data: appointment,
      paymentRequired: true,
      depositAmount,
      remainingAmount,
    });
  } catch (error) {
    if (error.code === '23P01') {
      return res.status(409).json({ message: 'Ya existe una cita en ese horario' });
    }
    next(error);
  }
};

export const cancelSkillAppointment = async (req, res, next) => {
  try {
    const linkedUser = await resolveLinkedUser(req, res);
    if (!linkedUser) return;

    const appointmentId = parsePositiveInt(req.params.id);
    if (!appointmentId) return res.status(400).json({ message: 'ID de cita inválido' });

    const existing = await Appointment.findById(appointmentId);
    if (!existing) return res.status(404).json({ message: 'Cita no encontrada' });

    if (existing.cliente_id !== linkedUser.usuario_id) {
      return res.status(403).json({ message: 'No tienes permiso para cancelar esta cita' });
    }
    if (existing.estado_id === 4) return res.status(400).json({ message: 'La cita ya está cancelada' });
    if (existing.estado_id === 3) return res.status(400).json({ message: 'No se puede cancelar una cita completada' });

    const motivo = typeof req.body.motivo === 'string' ? req.body.motivo.trim() : 'Cancelada desde Alexa';
    const cita = await Appointment.cancel(appointmentId, motivo, 4);

    res.json({ message: 'Cita cancelada correctamente', data: cita });
  } catch (error) {
    next(error);
  }
};

export const getSkillAvailableSlots = async (req, res, next) => {
  try {
    const linkedUser = await resolveLinkedUser(req, res);
    if (!linkedUser) return;

    const { barberoId, fecha } = req.query;
    if (!barberoId || !fecha) return res.status(400).json({ message: 'barberoId y fecha son requeridos' });

    const diaSemana = new Date(fecha).getDay();
    const horarioResult = await pool.query(
      `SELECT hora_inicio, hora_fin
       FROM horarios_barbero
       WHERE barbero_id = $1 AND dia_semana = $2 AND activo = true`,
      [barberoId, diaSemana]
    );

    if (horarioResult.rows.length === 0) return res.json({ disponibles: [] });

    const citasOcupadas = await pool.query(
      `SELECT hora_inicio, hora_fin
       FROM citas
       WHERE barbero_id = $1
         AND fecha = $2
         AND estado_id NOT IN (4, 5)`,
      [barberoId, fecha]
    );

    const timeToMinutes = (time) => {
      const [hours, minutes] = time.split(':').map(Number);
      return hours * 60 + minutes;
    };
    const minutesToTime = (minutes) => {
      const hours = Math.floor(minutes / 60);
      const mins = minutes % 60;
      return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:00`;
    };

    const startMinutes = timeToMinutes(horarioResult.rows[0].hora_inicio);
    const endMinutes = timeToMinutes(horarioResult.rows[0].hora_fin);
    const occupiedSlots = citasOcupadas.rows.map((cita) => ({
      start: timeToMinutes(cita.hora_inicio),
      end: timeToMinutes(cita.hora_fin),
    }));
    const disponibles = [];

    for (
      let current = startMinutes;
      current + APPOINTMENT_DURATION_MINUTES <= endMinutes;
      current += APPOINTMENT_DURATION_MINUTES + APPOINTMENT_BREAK_MINUTES
    ) {
      const slotEnd = current + APPOINTMENT_DURATION_MINUTES;
      const ocupado = occupiedSlots.some((occupied) => current < occupied.end && slotEnd > occupied.start);
      if (!ocupado) disponibles.push({ hora: minutesToTime(current), disponible: true });
    }

    res.json({ disponibles });
  } catch (error) {
    next(error);
  }
};

export const getSkillAvailableDates = async (req, res, next) => {
  try {
    const linkedUser = await resolveLinkedUser(req, res);
    if (!linkedUser) return;

    const barberoId = parsePositiveInt(req.query.barberoId);
    if (!barberoId) return res.status(400).json({ message: 'barberoId es requerido' });

    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    const fechasNoDisponibles = [];
    const fechasConDisponibilidad = [];

    for (let i = 0; i < 30; i += 1) {
      const fecha = new Date(hoy);
      fecha.setDate(hoy.getDate() + i);
      const fechaStr = fecha.toISOString().split('T')[0];
      const diaSemana = fecha.getDay();

      const horario = await pool.query(
        `SELECT hora_inicio, hora_fin
         FROM horarios_barbero
         WHERE barbero_id = $1 AND dia_semana = $2 AND activo = true`,
        [barberoId, diaSemana]
      );

      if (horario.rows.length === 0) {
        fechasNoDisponibles.push(fechaStr);
      } else {
        fechasConDisponibilidad.push(fechaStr);
      }
    }

    res.json({ fechasNoDisponibles, fechasConDisponibilidad });
  } catch (error) {
    next(error);
  }
};
