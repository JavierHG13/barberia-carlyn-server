import axios from 'axios';
import Appointment from '../models/appointment.js';
import Servicio from '../models/servicios.js';
import BarberoModel from '../models/barbero.js';
import { pool } from '../config/database.js';
import emailService from '../utils/emailService.js';

const MERCADO_PAGO_API_URL = 'https://api.mercadopago.com';
const APPOINTMENT_DURATION_MINUTES = 30;
const APPOINTMENT_BREAK_MINUTES = 10;
const CANCELLED_ESTADO_IDS = [4];
const DEPOSIT_PERCENTAGE = 1;

const pendingAppointments = new Map();

const parsePositiveInt = (value) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) || parsed <= 0 ? null : parsed;
};

const parseDateValue = (value) => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const parseTimeValue = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!/^\d{2}:\d{2}(:\d{2})?$/.test(trimmed)) return null;
  return trimmed.length === 5 ? `${trimmed}:00` : trimmed;
};

const addMinutesToTime = (timeStr, minutes) => {
  const parsed = parseTimeValue(timeStr);
  if (!parsed) return null;
  const [hours, mins] = parsed.split(':').map(Number);
  const totalMinutes = hours * 60 + mins + minutes;
  const hh = String(Math.floor(totalMinutes / 60) % 24).padStart(2, '0');
  const mm = String(totalMinutes % 60).padStart(2, '0');
  return `${hh}:${mm}:00`;
};

const getAccessToken = () => {
  const token = process.env.MERCADO_PAGO_ACCESS_TOKEN;
  if (!token) {
    throw {
      statusCode: 500,
      message: 'Falta configurar MERCADO_PAGO_ACCESS_TOKEN en el backend',
    };
  }
  return token;
};

const getFrontendUrl = () =>
  process.env.FRONTEND_URL || process.env.CLIENT_URL || 'http://localhost:5173';

const canUseAutoReturn = (url) => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && !['localhost', '127.0.0.1'].includes(parsed.hostname);
  } catch {
    return false;
  }
};

const buildExternalReference = () =>
  `cita_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

const buildExistingAppointmentReference = (appointmentId) =>
  `cita_existente_${appointmentId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const getEstadoIdByName = async (name, fallbackId) => {
  const result = await pool.query(
    'SELECT id FROM estados_cita WHERE LOWER(nombre) = LOWER($1) LIMIT 1',
    [name]
  );
  return result.rows[0]?.id ?? fallbackId;
};

const getAppointmentDeposit = (appointment) => {
  const total = Number(appointment.servicio_precio ?? appointment.servicio?.precio ?? 0);
  const depositAmount = Number((total * DEPOSIT_PERCENTAGE).toFixed(2));
  return {
    total,
    depositAmount,
    remainingAmount: Number((total - depositAmount).toFixed(2)),
  };
};

const validateAppointmentInput = async (body, userId) => {
  const localId = parsePositiveInt(body.localId);
  const barberoId = parsePositiveInt(body.barberoId);
  const servicioId = parsePositiveInt(body.servicioId);
  const fecha = body.fecha;
  const horaInicio = parseTimeValue(body.horaInicio);

  if (!localId) throw { statusCode: 400, message: 'localId inválido' };
  if (!barberoId) throw { statusCode: 400, message: 'barberoId inválido' };
  if (!servicioId) throw { statusCode: 400, message: 'servicioId inválido' };
  if (!parseDateValue(fecha)) throw { statusCode: 400, message: 'fecha inválida' };
  if (!horaInicio) throw { statusCode: 400, message: 'horaInicio inválida' };

  const servicio = await Servicio.findById(servicioId);
  if (!servicio || servicio.activo === false) {
    throw { statusCode: 404, message: 'Servicio no encontrado o inactivo' };
  }

  const barbero = await BarberoModel.getById(barberoId);
  if (!barbero || !barbero.activo) {
    throw { statusCode: 404, message: 'Barbero no encontrado o inactivo' };
  }

  if (barbero.local_id && Number(barbero.local_id) !== localId) {
    throw { statusCode: 409, message: 'El barbero no pertenece a la sucursal seleccionada' };
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
    throw { statusCode: 409, message: 'Ese horario ya no está disponible' };
  }

  return {
    clienteId: userId,
    localId,
    barberoId,
    servicioId,
    fecha,
    horaInicio,
    horaFin,
    estadoId: 1,
    servicio,
  };
};

export const createAppointmentPreference = async (req, res, next) => {
  try {
    const appointment = await validateAppointmentInput(req.body, req.user.id);
    const total = Number(appointment.servicio.precio);
    const depositAmount = Number((total * DEPOSIT_PERCENTAGE).toFixed(2));
    const externalReference = buildExternalReference();
    const frontendUrl = getFrontendUrl();

    pendingAppointments.set(externalReference, {
      appointment,
      depositAmount,
      createdAt: Date.now(),
    });

    const backUrls = {
      success: `${frontendUrl}/pago/cita/resultado`,
      failure: `${frontendUrl}/pago/cita/resultado`,
      pending: `${frontendUrl}/pago/cita/resultado`,
    };

    const preferencePayload = {
      items: [
        {
          id: String(appointment.servicioId),
          title: `Pago completo - ${appointment.servicio.nombre}`,
          description: `Cita en Barbería Carlyn el ${appointment.fecha} a las ${appointment.horaInicio.slice(0, 5)}`,
          quantity: 1,
          currency_id: process.env.MERCADO_PAGO_CURRENCY || 'MXN',
          unit_price: depositAmount,
        },
      ],
      payer: {
        name: req.user.nombre,
        email: req.user.email,
      },
      back_urls: backUrls,
      external_reference: externalReference,
      metadata: {
        type: 'appointment_deposit',
        user_id: req.user.id,
        local_id: appointment.localId,
        barbero_id: appointment.barberoId,
        servicio_id: appointment.servicioId,
      },
    };

    if (canUseAutoReturn(frontendUrl)) {
      preferencePayload.auto_return = 'approved';
    }

    const { data } = await axios.post(
      `${MERCADO_PAGO_API_URL}/checkout/preferences`,
      preferencePayload,
      {
        headers: {
          Authorization: `Bearer ${getAccessToken()}`,
          'Content-Type': 'application/json',
        },
      }
    );

    res.status(201).json({
      preferenceId: data.id,
      initPoint: data.init_point,
      sandboxInitPoint: data.sandbox_init_point,
      externalReference,
      total,
      depositAmount,
      remainingAmount: Number((total - depositAmount).toFixed(2)),
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    if (error.response) {
      console.error('Mercado Pago create preference error:', error.response.data);
      return res.status(error.response.status || 400).json({
        message: 'Mercado Pago rechazó la preferencia de pago',
        details: error.response.data,
      });
    }
    next(error);
  }
};

export const createExistingAppointmentPreference = async (req, res, next) => {
  try {
    const appointmentId = parsePositiveInt(req.params.id || req.body.appointmentId);
    if (!appointmentId) return res.status(400).json({ message: 'appointmentId inválido' });

    const appointment = await Appointment.findById(appointmentId);
    if (!appointment) return res.status(404).json({ message: 'Cita no encontrada' });

    if (appointment.cliente_id !== req.user.id) {
      return res.status(403).json({ message: 'Esta cita no pertenece a tu cuenta' });
    }

    if (['Cancelada', 'Completada'].includes(appointment.estado_nombre)) {
      return res.status(409).json({ message: 'Esta cita ya no admite pago' });
    }

    const { total, depositAmount, remainingAmount } = getAppointmentDeposit(appointment);
    const paidAmount = Number(appointment.monto_pagado || 0);
    if (paidAmount + 0.01 >= depositAmount) {
      return res.status(409).json({ message: 'El pago de esta cita ya fue cubierto' });
    }

    const externalReference = buildExistingAppointmentReference(appointment.id);
    const frontendUrl = getFrontendUrl();
    const backUrls = {
      success: `${frontendUrl}/pago/cita/resultado`,
      failure: `${frontendUrl}/pago/cita/resultado`,
      pending: `${frontendUrl}/pago/cita/resultado`,
    };

    const preferencePayload = {
      items: [
        {
          id: String(appointment.servicio_id),
          title: `Pago completo - ${appointment.servicio_nombre}`,
          description: `Cita en Barbería Carlyn el ${appointment.fecha} a las ${String(appointment.hora_inicio).slice(0, 5)}`,
          quantity: 1,
          currency_id: process.env.MERCADO_PAGO_CURRENCY || 'MXN',
          unit_price: depositAmount,
        },
      ],
      payer: {
        name: req.user.nombre,
        email: req.user.email,
      },
      back_urls: backUrls,
      external_reference: externalReference,
      metadata: {
        type: 'existing_appointment_deposit',
        user_id: req.user.id,
        appointment_id: appointment.id,
      },
    };

    if (canUseAutoReturn(frontendUrl)) {
      preferencePayload.auto_return = 'approved';
    }

    const { data } = await axios.post(
      `${MERCADO_PAGO_API_URL}/checkout/preferences`,
      preferencePayload,
      {
        headers: {
          Authorization: `Bearer ${getAccessToken()}`,
          'Content-Type': 'application/json',
        },
      }
    );

    res.status(201).json({
      preferenceId: data.id,
      initPoint: data.init_point,
      sandboxInitPoint: data.sandbox_init_point,
      externalReference,
      total,
      depositAmount,
      remainingAmount,
      appointmentId: appointment.id,
    });
  } catch (error) {
    if (error.response) {
      console.error('Mercado Pago existing appointment preference error:', error.response.data);
      return res.status(error.response.status || 400).json({
        message: 'Mercado Pago rechazó la preferencia de pago',
        details: error.response.data,
      });
    }
    next(error);
  }
};

export const confirmAppointmentPayment = async (req, res, next) => {
  try {
    const { paymentId } = req.body;
    if (!paymentId) return res.status(400).json({ message: 'paymentId es requerido' });

    const { data: payment } = await axios.get(`${MERCADO_PAGO_API_URL}/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${getAccessToken()}` },
    });

    if (payment.status !== 'approved') {
      return res.status(202).json({
        status: payment.status,
        message: 'El pago aún no está aprobado',
      });
    }

    const externalReference = payment.external_reference;
    const pending = pendingAppointments.get(externalReference);
    const confirmedEstadoId = await getEstadoIdByName('Confirmada', 2);
    let appointment;
    let paidAmount;

    if (pending) {
      if (pending.appointment.clienteId !== req.user.id) {
        return res.status(403).json({ message: 'Este pago no pertenece a tu cuenta' });
      }

      paidAmount = Number(payment.transaction_amount || pending.depositAmount);
      if (paidAmount + 0.01 < pending.depositAmount) {
        return res.status(409).json({ message: 'El pago aprobado no cubre el total requerido' });
      }

      appointment = await Appointment.create({
        ...pending.appointment,
        estadoId: confirmedEstadoId,
        montoPagado: paidAmount,
      });

      pendingAppointments.delete(externalReference);
    } else {
      const appointmentId =
        Number(payment.metadata?.appointment_id) ||
        Number(String(externalReference || '').match(/^cita_existente_(\d+)_/)?.[1]);

      if (!appointmentId) {
        return res.status(404).json({
          message: 'No se encontró la reserva temporal para este pago. Intenta agendar nuevamente.',
        });
      }

      const existing = await Appointment.findById(appointmentId);
      if (!existing) return res.status(404).json({ message: 'Cita no encontrada para este pago' });
      if (existing.cliente_id !== req.user.id) {
        return res.status(403).json({ message: 'Este pago no pertenece a tu cuenta' });
      }

      const { depositAmount } = getAppointmentDeposit(existing);
      paidAmount = Number(payment.transaction_amount || depositAmount);
      if (paidAmount + 0.01 < depositAmount) {
        return res.status(409).json({ message: 'El pago aprobado no cubre el total requerido' });
      }

      appointment = await Appointment.updateById(existing.id, {
        estadoId: confirmedEstadoId,
        montoPagado: paidAmount,
      });
    }

    emailService.sendAppointmentConfirmedEmail(
      appointment.cliente_email || req.user.email,
      appointment.cliente_nombre || req.user.nombre,
      appointment,
      {
        id: payment.id,
        status: payment.status,
        amount: paidAmount,
        externalReference,
      }
    ).catch((err) => console.error('Error al enviar correo de cita confirmada:', err.message));

    res.status(201).json({
      message: 'Pago aprobado y cita agendada correctamente',
      data: appointment,
      payment: {
        id: payment.id,
        status: payment.status,
        amount: paidAmount,
        externalReference,
      },
    });
  } catch (error) {
    if (error.response) {
      console.error('Mercado Pago confirm payment error:', error.response.data);
      return res.status(error.response.status || 400).json({
        message: 'Mercado Pago rechazó la consulta del pago',
        details: error.response.data,
      });
    }
    next(error);
  }
};
