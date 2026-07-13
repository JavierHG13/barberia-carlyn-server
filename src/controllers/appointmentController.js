import Appointment from '../models/appointment.js';
import BarberoModel from '../models/barbero.js';
import { query, pool } from '../config/database.js';

// ─── Estado IDs — ajusta según tu tabla estados_cita ────────────────────────
// Ejemplo: 1=Agendada, 2=Confirmada, 3=Completada, 4=Cancelada, 5=No_asistio
const CANCELLED_ESTADO_ID = 4;
const CANCELLED_ESTADO_IDS = [CANCELLED_ESTADO_ID];
const COMPLETED_ESTADO_ID = 3;
const NO_SHOW_ESTADO_ID = 5;
const PENDING_ESTADO_IDS = [1, 2]; // estados "abiertos" para markNoShow

const APPOINTMENT_DURATION_MINUTES = 30;
const APPOINTMENT_BREAK_MINUTES = 10;

// ─── Helpers ────────────────────────────────────────────────────────────────

const parsePositiveInt = (value) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) || parsed <= 0 ? null : parsed;
};

/**
 * Validates a date string and returns a Date, or null if invalid.
 */
const parseDateValue = (value) => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

/**
 * Validates a time string in HH:MM or HH:MM:SS format.
 * Returns the normalized string or null.
 */
const parseTimeValue = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!/^\d{2}:\d{2}(:\d{2})?$/.test(trimmed)) return null;
  return trimmed;
};

/**
 * Add APPOINTMENT_DURATION_MINUTES to a HH:MM[:SS] string.
 * Returns a HH:MM:SS string, or null if the input is invalid.
 */
const addMinutesToTime = (timeStr, minutes) => {
  const parsed = parseTimeValue(timeStr);
  if (!parsed) return null;
  const [h, m] = parsed.split(':').map(Number);
  const totalMinutes = h * 60 + m + minutes;
  const hh = String(Math.floor(totalMinutes / 60) % 24).padStart(2, '0');
  const mm = String(totalMinutes % 60).padStart(2, '0');
  return `${hh}:${mm}:00`;
};

/**
 * Returns true when two HH:MM[:SS] strings represent the same time.
 */
const timesMatch = (a, b) => {
  const normalize = (t) => t.length === 5 ? `${t}:00` : t;
  return normalize(a) === normalize(b);
};

// NUEVO: valida barbero activo y resuelve/valida el local de la cita.
// Devuelve { localId } o lanza un objeto { status, message } que el
// caller debe convertir en response.
const resolveLocalParaCita = async (barberoId, localIdInput) => {
  const barbero = await BarberoModel.getById(barberoId);

  if (!barbero || !barbero.activo) {
    throw { status: 404, message: 'Barbero no encontrado o inactivo' };
  }

  if (!localIdInput) {
    // No se mandó local -> se toma el del barbero (puede ser null si
    // aún no lo has migrado/asignado)
    return barbero.local_id;
  }

  const localId = parsePositiveInt(localIdInput);
  if (!localId) {
    throw { status: 400, message: 'localId inválido' };
  }

  if (barbero.local_id && localId !== barbero.local_id) {
    throw {
      status: 409,
      message: `Este barbero pertenece a "${barbero.local_nombre}", no al local indicado`,
    };
  }

  return localId;
};

// ─── Controllers ────────────────────────────────────────────────────────────

export const createAppointment = async (req, res, next) => {
  try {
    const {
      clienteId,
      barberoId,
      servicioId,
      localId,
      fecha,
      horaInicio,
      horaFin,
      estadoId,
      notas,
      metodoPagoId,
      montoPagado,
      motivoCancelacion,
    } = req.body;

    // Validate required IDs
    if (!parsePositiveInt(clienteId)) return res.status(400).json({ message: 'clienteId inválido' });
    if (!parsePositiveInt(barberoId)) return res.status(400).json({ message: 'barberoId inválido' });
    if (!parsePositiveInt(servicioId)) return res.status(400).json({ message: 'servicioId inválido' });
    if (!parsePositiveInt(estadoId)) return res.status(400).json({ message: 'estadoId inválido' });

    // Validate fecha
    if (!parseDateValue(fecha)) return res.status(400).json({ message: 'fecha inválida' });

    // Validate horaInicio
    const parsedHoraInicio = parseTimeValue(horaInicio);
    if (!parsedHoraInicio) return res.status(400).json({ message: 'horaInicio inválida (formato HH:MM o HH:MM:SS)' });

    // Derive expected horaFin
    const expectedHoraFin = addMinutesToTime(parsedHoraInicio, APPOINTMENT_DURATION_MINUTES);

    // If horaFin was provided, verify it matches the expected value
    if (horaFin !== undefined && horaFin !== null) {
      const parsedHoraFin = parseTimeValue(horaFin);
      if (!parsedHoraFin) return res.status(400).json({ message: 'horaFin inválida (formato HH:MM o HH:MM:SS)' });

      if (!timesMatch(parsedHoraFin, expectedHoraFin)) {
        return res.status(400).json({
          message: `Cada cita debe durar exactamente ${APPOINTMENT_DURATION_MINUTES} minutos`,
        });
      }
    }

    // NUEVO: resolver/validar el local de la cita a partir del barbero
    let resolvedLocalId;
    try {
      resolvedLocalId = await resolveLocalParaCita(Number(barberoId), localId);
    } catch (err) {
      if (err.status) return res.status(err.status).json({ message: err.message });
      throw err;
    }

    // Check scheduling conflict for this barbero
    const conflict = await Appointment.hasConflict({
      barberoId: Number(barberoId),
      fecha,
      horaInicio: parsedHoraInicio,
      horaFin: expectedHoraFin,
      breakMinutes: APPOINTMENT_BREAK_MINUTES,
      cancelledEstadoIds: CANCELLED_ESTADO_IDS,
    });

    if (conflict) {
      return res.status(409).json({
        message: `Ya existe una cita en ese horario. Debe haber ${APPOINTMENT_BREAK_MINUTES} minutos de descanso entre citas`,
      });
    }

    const appointment = await Appointment.create({
      clienteId: Number(clienteId),
      barberoId: Number(barberoId),
      servicioId: Number(servicioId),
      localId: resolvedLocalId, // NUEVO
      fecha,
      horaInicio: parsedHoraInicio,
      horaFin: expectedHoraFin,
      estadoId: Number(estadoId),
      notas: typeof notas === 'string' ? notas.trim() || null : null,
      metodoPagoId: metodoPagoId ? Number(metodoPagoId) : null,
      montoPagado: montoPagado ?? null,
      motivoCancelacion: typeof motivoCancelacion === 'string' ? motivoCancelacion.trim() || null : null,
    });

    // Notificación de confirmación
    await query(
      `INSERT INTO notificaciones (usuario_id, cita_id, tipo, mensaje)
       VALUES ($1, $2, 'confirmacion', $3)`,
      [
        Number(clienteId),
        appointment.id,
        `Tu cita ha sido agendada para el ${fecha} a las ${parsedHoraInicio}`,
      ]
    ).catch((err) => console.error('Error al crear notificación:', err));

    res.status(201).json({
      message: 'Cita agendada correctamente',
      data: appointment,
    });
  } catch (error) {
    // 23P01 = exclusion_violation -> por si el EXCLUDE constraint de la BD
    // atrapa un traslape que el chequeo en JS no vio (carrera entre requests)
    if (error.code === '23P01') {
      return res.status(409).json({ message: 'Ya existe una cita en ese horario' });
    }
    next(error);
  }
};

export const updateAppointment = async (req, res, next) => {
  try {
    const appointmentId = parsePositiveInt(req.params.id);
    if (!appointmentId) return res.status(400).json({ message: 'ID de cita inválido' });

    const existing = await Appointment.findById(appointmentId);
    if (!existing) return res.status(404).json({ message: 'Cita no encontrada' });

    const updates = {};

    // ── Optional FK fields ──────────────────────────────────────────────────
    for (const field of ['clienteId', 'barberoId', 'servicioId', 'estadoId', 'metodoPagoId']) {
      if (req.body[field] !== undefined) {
        const parsed = parsePositiveInt(req.body[field]);
        if (!parsed) return res.status(400).json({ message: `${field} inválido` });
        updates[field] = parsed;
      }
    }

    // NUEVO: si cambia el barbero, o si mandan localId explícito,
    // revalidamos que local_id siga siendo consistente con el barbero.
    if (req.body.localId !== undefined || updates.barberoId !== undefined) {
      const mergedBarberoId = updates.barberoId ?? existing.barbero_id;
      try {
        updates.localId = await resolveLocalParaCita(mergedBarberoId, req.body.localId);
      } catch (err) {
        if (err.status) return res.status(err.status).json({ message: err.message });
        throw err;
      }
    }

    // ── fecha ────────────────────────────────────────────────────────────────
    if (req.body.fecha !== undefined) {
      if (!parseDateValue(req.body.fecha)) {
        return res.status(400).json({ message: 'fecha inválida' });
      }
      updates.fecha = req.body.fecha;
    }

    // ── horaInicio / horaFin ─────────────────────────────────────────────────
    const hasStartInput = req.body.horaInicio !== undefined;
    const hasEndInput = req.body.horaFin !== undefined;

    if (hasStartInput || hasEndInput) {
      const baseHoraInicio = hasStartInput
        ? parseTimeValue(req.body.horaInicio)
        : existing.hora_inicio;

      if (!baseHoraInicio) {
        return res.status(400).json({ message: 'horaInicio inválida (formato HH:MM o HH:MM:SS)' });
      }

      const expectedHoraFin = addMinutesToTime(baseHoraInicio, APPOINTMENT_DURATION_MINUTES);

      if (hasEndInput) {
        const parsedHoraFin = parseTimeValue(req.body.horaFin);
        if (!parsedHoraFin) {
          return res.status(400).json({ message: 'horaFin inválida (formato HH:MM o HH:MM:SS)' });
        }
        if (!timesMatch(parsedHoraFin, expectedHoraFin)) {
          return res.status(400).json({
            message: `Cada cita debe durar exactamente ${APPOINTMENT_DURATION_MINUTES} minutos`,
          });
        }
      }

      updates.horaInicio = baseHoraInicio;
      updates.horaFin = expectedHoraFin;
    }

    // ── notas ────────────────────────────────────────────────────────────────
    if (req.body.notas !== undefined) {
      if (req.body.notas === null) {
        updates.notas = null;
      } else if (typeof req.body.notas === 'string') {
        updates.notas = req.body.notas.trim() || null;
      } else {
        return res.status(400).json({ message: 'notas inválidas' });
      }
    }

    // ── motivoCancelacion ────────────────────────────────────────────────────
    if (req.body.motivoCancelacion !== undefined) {
      updates.motivoCancelacion = typeof req.body.motivoCancelacion === 'string'
        ? req.body.motivoCancelacion.trim() || null
        : null;
    }

    // ── montoPagado ──────────────────────────────────────────────────────────
    if (req.body.montoPagado !== undefined) {
      const val = Number(req.body.montoPagado);
      if (req.body.montoPagado !== null && (Number.isNaN(val) || val < 0)) {
        return res.status(400).json({ message: 'montoPagado inválido' });
      }
      updates.montoPagado = req.body.montoPagado === null ? null : val;
    }

    // ── recordatorioEnviado ──────────────────────────────────────────────────
    if (req.body.recordatorioEnviado !== undefined) {
      if (typeof req.body.recordatorioEnviado !== 'boolean') {
        return res.status(400).json({ message: 'recordatorioEnviado debe ser booleano' });
      }
      updates.recordatorioEnviado = req.body.recordatorioEnviado;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ message: 'No hay cambios para actualizar' });
    }

    // ── Conflict check (skip if moving to cancelled estado) ──────────────────
    const mergedEstadoId = updates.estadoId ?? existing.estado_id;
    const mergedBarberoId = updates.barberoId ?? existing.barbero_id;
    const mergedFecha = updates.fecha ?? existing.fecha;
    const mergedStart = updates.horaInicio ?? existing.hora_inicio;
    const mergedEnd = updates.horaFin ?? existing.hora_fin;

    if (!CANCELLED_ESTADO_IDS.includes(mergedEstadoId)) {
      const conflict = await Appointment.hasConflict({
        barberoId: mergedBarberoId,
        fecha: mergedFecha,
        horaInicio: mergedStart,
        horaFin: mergedEnd,
        breakMinutes: APPOINTMENT_BREAK_MINUTES,
        excludeId: appointmentId,
        cancelledEstadoIds: CANCELLED_ESTADO_IDS,
      });

      if (conflict) {
        return res.status(409).json({
          message: `Ya existe otra cita en ese horario. Debe haber ${APPOINTMENT_BREAK_MINUTES} minutos de descanso entre citas`,
        });
      }
    }

    const updated = await Appointment.updateById(appointmentId, updates);

    res.json({
      message: 'Cita actualizada correctamente',
      data: updated,
    });
  } catch (error) {
    if (error.code === '23P01') {
      return res.status(409).json({ message: 'Ya existe una cita en ese horario' });
    }
    next(error);
  }
};

export const searchAppointments = async (req, res, next) => {
  try {
    const page = parsePositiveInt(req.query.page) || 1;
    const limit = parsePositiveInt(req.query.limit) || 10;
    const safeLimit = Math.min(limit, 100);
    const offset = (page - 1) * safeLimit;

    const fechaInicio = req.query.fechaInicio ? parseDateValue(req.query.fechaInicio) : null;
    const fechaFin = req.query.fechaFin ? parseDateValue(req.query.fechaFin) : null;

    if (req.query.fechaInicio && !fechaInicio) return res.status(400).json({ message: 'fechaInicio inválida' });
    if (req.query.fechaFin && !fechaFin) return res.status(400).json({ message: 'fechaFin inválida' });

    const estadoId = req.query.estadoId ? parsePositiveInt(req.query.estadoId) : null;
    const barberoId = req.query.barberoId ? parsePositiveInt(req.query.barberoId) : null;
    const clienteId = req.query.clienteId ? parsePositiveInt(req.query.clienteId) : null;
    const localId = req.query.localId ? parsePositiveInt(req.query.localId) : null; // NUEVO

    if (req.query.estadoId && !estadoId) return res.status(400).json({ message: 'estadoId inválido' });
    if (req.query.barberoId && !barberoId) return res.status(400).json({ message: 'barberoId inválido' });
    if (req.query.clienteId && !clienteId) return res.status(400).json({ message: 'clienteId inválido' });
    if (req.query.localId && !localId) return res.status(400).json({ message: 'localId inválido' });

    const filters = {
      q: typeof req.query.q === 'string' ? req.query.q.trim() : '',
      telefono: typeof req.query.telefono === 'string' ? req.query.telefono.trim() : '',
      fechaInicio,
      fechaFin,
      estadoId,
      barberoId,
      clienteId,
      localId, // NUEVO
    };

    const [appointments, total] = await Promise.all([
      Appointment.search({ ...filters, limit: safeLimit, offset }),
      Appointment.countSearch(filters),
    ]);

    res.json({
      message: 'Citas obtenidas correctamente',
      data: appointments,
      pagination: {
        page,
        limit: safeLimit,
        total,
        totalPages: Math.max(1, Math.ceil(total / safeLimit)),
      },
    });
  } catch (error) {
    next(error);
  }
};

export const getUpcomingAppointments = async (req, res, next) => {
  try {
    const dias = Math.min(parsePositiveInt(req.query.dias) || 3, 30);
    const fromDate = new Date();
    const toDate = new Date(Date.now() + dias * 24 * 60 * 60 * 1000);

    const estadoId = req.query.estadoId ? parsePositiveInt(req.query.estadoId) : null;
    const barberoId = req.query.barberoId ? parsePositiveInt(req.query.barberoId) : null;
    const clienteId = req.query.clienteId ? parsePositiveInt(req.query.clienteId) : null;
    const localId = req.query.localId ? parsePositiveInt(req.query.localId) : null; // NUEVO

    const appointments = await Appointment.search({
      q: typeof req.query.q === 'string' ? req.query.q.trim() : '',
      telefono: typeof req.query.telefono === 'string' ? req.query.telefono.trim() : '',
      fechaInicio: fromDate,
      fechaFin: toDate,
      estadoId,
      barberoId,
      clienteId,
      localId, // NUEVO
      limit: 300,
      offset: 0,
    });

    res.json({
      message: `Citas de los próximos ${dias} días obtenidas correctamente`,
      range: {
        from: fromDate.toISOString(),
        to: toDate.toISOString(),
      },
      total: appointments.length,
      data: appointments,
    });
  } catch (error) {
    next(error);
  }
};

export const getAppointmentsCalendar = async (req, res, next) => {
  try {
    const parsedFrom = req.query.from ? parseDateValue(req.query.from) : null;
    const parsedTo = req.query.to ? parseDateValue(req.query.to) : null;

    if (req.query.from && !parsedFrom) return res.status(400).json({ message: 'from inválido' });
    if (req.query.to && !parsedTo) return res.status(400).json({ message: 'to inválido' });

    const fromDate = parsedFrom || new Date();
    const toDate = parsedTo || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    if (toDate <= fromDate) {
      return res.status(400).json({ message: 'El rango del calendario es inválido' });
    }

    const estadoId = req.query.estadoId ? parsePositiveInt(req.query.estadoId) : null;
    const barberoId = req.query.barberoId ? parsePositiveInt(req.query.barberoId) : null;
    const localId = req.query.localId ? parsePositiveInt(req.query.localId) : null; // NUEVO

    if (req.query.estadoId && !estadoId) return res.status(400).json({ message: 'estadoId inválido' });
    if (req.query.barberoId && !barberoId) return res.status(400).json({ message: 'barberoId inválido' });
    if (req.query.localId && !localId) return res.status(400).json({ message: 'localId inválido' });

    const appointments = await Appointment.getCalendar({
      from: fromDate,
      to: toDate,
      barberoId,
      estadoId,
      localId, // NUEVO
    });

    // Group by date (YYYY-MM-DD)
    const byDate = appointments.reduce((acc, cita) => {
      const key = String(cita.fecha).slice(0, 10);
      if (!acc[key]) acc[key] = [];
      acc[key].push(cita);
      return acc;
    }, {});

    const calendar = Object.entries(byDate)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, citas]) => ({ date, total: citas.length, citas }));

    res.json({
      message: 'Calendario obtenido correctamente',
      range: {
        from: fromDate.toISOString(),
        to: toDate.toISOString(),
      },
      totalCitas: appointments.length,
      data: calendar,
    });
  } catch (error) {
    next(error);
  }
};

// ─── GET /api/citas  (con filtros y scope por rol) ──────────────────────────
export const getAllAppointments = async (req, res, next) => {

  console.log('User rol:', req.user.rol);
  console.log('User ID:', req.user.id);
  
  try {
    const estadoId = req.query.estadoId ? parsePositiveInt(req.query.estadoId) : null;
    const barberoId = req.query.barberoId ? parsePositiveInt(req.query.barberoId) : null;
    const clienteId = req.query.clienteId ? parsePositiveInt(req.query.clienteId) : null;
    const localId = req.query.localId ? parsePositiveInt(req.query.localId) : null; // NUEVO

    if (req.query.estadoId && !estadoId) return res.status(400).json({ message: 'estadoId inválido' });
    if (req.query.barberoId && !barberoId) return res.status(400).json({ message: 'barberoId inválido' });
    if (req.query.clienteId && !clienteId) return res.status(400).json({ message: 'clienteId inválido' });
    if (req.query.localId && !localId) return res.status(400).json({ message: 'localId inválido' });

    const citas = await Appointment.findAll({
      userRole: req.user.rol,
      userId: req.user.id,
      fecha: req.query.fecha || null,
      barberoId,
      clienteId,
      estadoId,
      localId, // NUEVO
    });

    res.json({ message: 'Citas obtenidas correctamente', data: citas, total: citas.length });
  } catch (error) {
    next(error);
  }
};

// ─── GET /api/citas/:id ──────────────────────────────────────────────────────
export const getAppointmentById = async (req, res, next) => {
  try {
    const appointmentId = parsePositiveInt(req.params.id);
    if (!appointmentId) return res.status(400).json({ message: 'ID de cita inválido' });

    const cita = await Appointment.findById(appointmentId);
    if (!cita) return res.status(404).json({ message: 'Cita no encontrada' });

    // Clientes solo pueden ver sus propias citas
    if (req.user.rol === 'cliente' && cita.cliente_id !== req.user.id) {
      return res.status(403).json({ message: 'No tienes permiso para ver esta cita' });
    }

    res.json({ message: 'Cita obtenida correctamente', data: cita });
  } catch (error) {
    next(error);
  }
};

// ─── DELETE /api/citas/:id  (cancelar) ──────────────────────────────────────
export const cancelAppointment = async (req, res, next) => {
  try {
    const appointmentId = parsePositiveInt(req.params.id);
    if (!appointmentId) return res.status(400).json({ message: 'ID de cita inválido' });

    const existing = await Appointment.findById(appointmentId);
    if (!existing) return res.status(404).json({ message: 'Cita no encontrada' });

    // Clientes solo pueden cancelar sus propias citas
    if (req.user.rol === 'cliente' && existing.cliente_id !== req.user.id) {
      return res.status(403).json({ message: 'No tienes permiso para cancelar esta cita' });
    }

    if (existing.estado_id === CANCELLED_ESTADO_ID) {
      return res.status(400).json({ message: 'La cita ya está cancelada' });
    }

    if (existing.estado_id === COMPLETED_ESTADO_ID) {
      return res.status(400).json({ message: 'No se puede cancelar una cita completada' });
    }

    const motivo = typeof req.body.motivo === 'string' ? req.body.motivo.trim() : null;
    const cita = await Appointment.cancel(appointmentId, motivo, CANCELLED_ESTADO_ID);

    // Notificación de cancelación
    await query(
      `INSERT INTO notificaciones (usuario_id, cita_id, tipo, mensaje)
       VALUES ($1, $2, 'cancelacion', $3)`,
      [
        existing.cliente_id,
        appointmentId,
        `Tu cita del ${String(existing.fecha).slice(0, 10)} a las ${existing.hora_inicio} ha sido cancelada`,
      ]
    ).catch((err) => console.error('Error al crear notificación:', err));

    res.json({ message: 'Cita cancelada correctamente', data: cita });
  } catch (error) {
    next(error);
  }
};

// ─── PUT /api/citas/:id/completar ───────────────────────────────────────────
export const completeAppointment = async (req, res, next) => {
  try {
    const appointmentId = parsePositiveInt(req.params.id);
    if (!appointmentId) return res.status(400).json({ message: 'ID de cita inválido' });

    const existing = await Appointment.findById(appointmentId);
    if (!existing) return res.status(404).json({ message: 'Cita no encontrada' });

    if (existing.estado_id === CANCELLED_ESTADO_ID) {
      return res.status(400).json({ message: 'No se puede completar una cita cancelada' });
    }

    if (existing.estado_id === COMPLETED_ESTADO_ID) {
      return res.status(400).json({ message: 'La cita ya está completada' });
    }

    const metodoPagoId = req.body.metodoPagoId ? parsePositiveInt(req.body.metodoPagoId) : null;
    if (req.body.metodoPagoId && !metodoPagoId) {
      return res.status(400).json({ message: 'metodoPagoId inválido' });
    }

    const cita = await Appointment.complete(appointmentId, COMPLETED_ESTADO_ID, metodoPagoId);

    res.json({ message: 'Cita marcada como completada', data: cita });
  } catch (error) {
    next(error);
  }
};

// ─── POST /api/citas/mark-no-show  (tarea programada / admin) ───────────────
export const markNoShowAppointments = async (req, res, next) => {
  try {
    // Default: marcar como no_asistio las citas anteriores a hoy
    const fechaLimite = req.body.fechaLimite || new Date().toISOString().slice(0, 10);

    if (!parseDateValue(fechaLimite)) {
      return res.status(400).json({ message: 'fechaLimite inválida' });
    }

    const count = await Appointment.markNoShow(fechaLimite, NO_SHOW_ESTADO_ID, PENDING_ESTADO_IDS);

    res.json({
      message: `${count} cita(s) marcada(s) como no_asistio`,
      updated: count,
    });
  } catch (error) {
    next(error);
  }

};



// En appointmentController.js
/**
 * GET /api/citas/horarios-disponibles
 * Obtiene horarios disponibles para un barbero en una fecha específica
 */
export const getAvailableSlots = async (req, res, next) => {
  try {
    const { barberoId, fecha } = req.query;

    if (!barberoId || !fecha) {
      return res.status(400).json({ message: 'barberoId y fecha son requeridos' });
    }

    const diaSemana = new Date(fecha).getDay();

    // 1. Obtener horario del barbero para ese día
    const horarioResult = await pool.query(
      `SELECT hora_inicio, hora_fin, activo 
       FROM horarios_barbero 
       WHERE barbero_id = $1 AND dia_semana = $2 AND activo = true`,
      [barberoId, diaSemana]
    );

    if (horarioResult.rows.length === 0) {
      return res.json({ disponibles: [] });
    }

    const horario = horarioResult.rows[0];
    const startTime = horario.hora_inicio;
    const endTime = horario.hora_fin;

    // 2. Obtener citas OCUPADAS de ese día (excluir canceladas y no asistió)
    const citasOcupadas = await pool.query(
      `SELECT id, hora_inicio, hora_fin 
       FROM citas 
       WHERE barbero_id = $1 
         AND fecha = $2 
         AND estado_id NOT IN (4, 5)`, // 4=cancelada, 5=no_asistio
      [barberoId, fecha]
    );

    // 3. Parámetros
    const SLOT_DURATION = 30; // minutos por cita
    const BREAK_MINUTES = 10; // minutos de descanso entre citas
    const SLOT_INTERVAL = SLOT_DURATION + BREAK_MINUTES; // 40 minutos entre slots

    const startMinutes = timeToMinutes(startTime);
    const endMinutes = timeToMinutes(endTime);

    // Convertir citas ocupadas a minutos para facilitar comparación
    const occupiedSlots = citasOcupadas.rows.map(cita => ({
      start: timeToMinutes(cita.hora_inicio),
      end: timeToMinutes(cita.hora_fin)
    }));

    const disponibles = [];

    // Generar slots cada 40 minutos (30 de cita + 10 de descanso)
    for (let current = startMinutes; current + SLOT_DURATION <= endMinutes; current += SLOT_INTERVAL) {
      const slotStart = current;
      const slotEnd = current + SLOT_DURATION;

      // Verificar si el slot está ocupado por alguna cita existente
      let estaOcupado = false;
      for (const occupied of occupiedSlots) {
        // Hay superposición si el slot y la cita se cruzan
        if (slotStart < occupied.end && slotEnd > occupied.start) {
          estaOcupado = true;
          break;
        }
      }

      if (!estaOcupado) {
        disponibles.push({
          hora: minutesToTime(slotStart),
          disponible: true
        });
      }
    }

    res.json({ disponibles });
  } catch (error) {
    console.error('Error en getAvailableSlots:', error);
    next(error);
  }
};



/**
 * GET /api/citas/fechas-disponibles
 * Obtiene fechas disponibles vs no disponibles para un barbero
 */
export const getAvailableDates = async (req, res, next) => {
  try {
    const { barberoId } = req.query;

    if (!barberoId) {
      return res.status(400).json({ message: 'barberoId es requerido' });
    }

    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    const fechasNoDisponibles = [];
    const fechasConDisponibilidad = [];

    // Evaluar próximos 30 días
    for (let i = 0; i < 30; i++) {
      const fecha = new Date(hoy);
      fecha.setDate(hoy.getDate() + i);
      const fechaStr = fecha.toISOString().split('T')[0];
      const diaSemana = fecha.getDay(); // 0 = domingo, 1 = lunes...

      // 1. Verificar si el barbero trabaja ese día (tiene horario configurado y activo)
      const horario = await pool.query(
        `SELECT hora_inicio, hora_fin, activo 
         FROM horarios_barbero 
         WHERE barbero_id = $1 AND dia_semana = $2 AND activo = true`,
        [barberoId, diaSemana]
      );

      // Si no trabaja ese día, marcar como no disponible
      if (horario.rows.length === 0) {
        fechasNoDisponibles.push(fechaStr);
        continue;
      }

      // 2. Obtener citas ocupadas de ese día (excluir canceladas y no asistió)
      const citasOcupadas = await pool.query(
        `SELECT hora_inicio, hora_fin 
         FROM citas 
         WHERE barbero_id = $1 
           AND fecha = $2 
           AND estado_id NOT IN (4, 5)`, // 4=cancelada, 5=no_asistio
        [barberoId, fechaStr]
      );

      // 3. Generar todos los slots posibles del día
      const start = horario.rows[0].hora_inicio;
      const end = horario.rows[0].hora_fin;
      const SLOT_DURATION = 30; // minutos
      const BREAK_MINUTES = 10; // minutos de descanso entre citas

      let current = timeToMinutes(start);
      const endMinutes = timeToMinutes(end);
      const slotsDisponibles = [];

      while (current + SLOT_DURATION <= endMinutes) {
        const slotStart = minutesToTime(current);
        const slotEnd = minutesToTime(current + SLOT_DURATION);

        // Verificar si el slot está ocupado
        let ocupado = false;
        for (const cita of citasOcupadas.rows) {
          const citaStart = timeToMinutes(cita.hora_inicio);
          const citaEnd = timeToMinutes(cita.hora_fin);

          // Si hay superposición, el slot está ocupado
          if (current < citaEnd && current + SLOT_DURATION > citaStart) {
            ocupado = true;
            break;
          }
        }

        if (!ocupado) {
          slotsDisponibles.push(slotStart);
        }

        // Avanzar 40 minutos (30 de cita + 10 de descanso)
        current += SLOT_DURATION + BREAK_MINUTES;
      }

      // Si no hay slots disponibles, la fecha es no disponible
      if (slotsDisponibles.length === 0) {
        fechasNoDisponibles.push(fechaStr);
      } else {
        fechasConDisponibilidad.push(fechaStr);
      }
    }

    res.json({
      fechasNoDisponibles,
      fechasConDisponibilidad
    });
  } catch (error) {
    console.error('Error en getAvailableDates:', error);
    console.log(error)
    next(error);
  }
};

// Funciones auxiliares
const timeToMinutes = (time) => {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
};

const minutesToTime = (minutes) => {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:00`;
};