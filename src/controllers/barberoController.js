import BarberoModel from '../models/barbero.js';

// ─── Helper: obtener barbero_id verificando que el usuario sea el dueño ──
const getBarberoIdSeguro = async (usuarioId) => {
  const perfil = await BarberoModel.getPerfilByUsuarioId(usuarioId);
  if (!perfil) throw { status: 404, mensaje: 'Perfil de barbero no encontrado' };
  return perfil.barbero_id;
};

// GET /api/barberos?localId=2  (NUEVO: filtro opcional por local)
export const listarBarberos = async (req, res) => {
  try {
    const { localId } = req.query;
    const barberos = await BarberoModel.getAllBarberos(localId || null);
    res.json({ ok: true, data: barberos, total: barberos.length });
  } catch (error) {
    console.error(error);
    res.status(500).json({ ok: false, mensaje: 'Error al obtener barberos' });
  }
};

// GET /api/barberos/local/:localId
// NUEVO: endpoint dedicado para el flujo de reserva — el cliente elige
// primero la sucursal y aquí se listan solo los barberos activos de ahí.
export const listarBarberosPorLocal = async (req, res) => {
  try {
    const { localId } = req.params;
    const barberos = await BarberoModel.getByLocalId(localId);
    res.json({ ok: true, data: barberos, total: barberos.length });
  } catch (error) {
    console.error(error);
    res.status(500).json({ ok: false, mensaje: 'Error al obtener barberos del local' });
  }
};

// PATCH /api/barberos/:id/local
// NUEVO: reasignar un barbero a otro local (uso admin).
// Body: { localId }
export const asignarLocalBarbero = async (req, res) => {
  try {
    const { id } = req.params;
    const { localId } = req.body;

    if (!localId) {
      return res.status(400).json({ ok: false, mensaje: 'localId es obligatorio' });
    }

    const actualizado = await BarberoModel.assignLocal(id, localId);

    if (!actualizado) {
      return res.status(404).json({ ok: false, mensaje: 'Barbero no encontrado' });
    }

    res.json({ ok: true, mensaje: 'Barbero reasignado de local', data: actualizado });
  } catch (error) {
    console.error(error);
    res.status(500).json({ ok: false, mensaje: 'Error al asignar local' });
  }
};

// ─── PERFIL ───────────────────────────────────────────────────────────────

// GET /api/barbero/perfil
export const getPerfil = async (req, res) => {
  try {
    // req.user.id viene del middleware de autenticación
    const perfil = await BarberoModel.getPerfilByUsuarioId(req.user.id);

    if (!perfil) {
      return res.status(404).json({ ok: false, mensaje: 'Perfil no encontrado' });
    }

    res.json({ ok: true, data: perfil });
  } catch (error) {
    console.error(error);
    res.status(500).json({ ok: false, mensaje: 'Error al obtener perfil' });
  }
};

// PUT /api/barbero/perfil
export const updatePerfil = async (req, res) => {
  try {
    const barberoId = await getBarberoIdSeguro(req.user.id);
    const actualizado = await BarberoModel.updatePerfil(barberoId, req.body);

    if (!actualizado) {
      return res.status(400).json({ ok: false, mensaje: 'Sin cambios para actualizar' });
    }

    res.json({ ok: true, mensaje: 'Perfil actualizado', data: actualizado });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ ok: false, mensaje: error.mensaje });
    }
    console.error(error);
    res.status(500).json({ ok: false, mensaje: 'Error al actualizar perfil' });
  }
};

// ─── CITAS ────────────────────────────────────────────────────────────────

// GET /api/barbero/citas/proximas
export const getProximasCitas = async (req, res) => {
  try {
    const barberoId = await getBarberoIdSeguro(req.user.id);
    const { limit = 10 } = req.query;

    const citas = await BarberoModel.getProximasCitas(barberoId, Number(limit));

    res.json({ ok: true, data: citas, total: citas.length });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ ok: false, mensaje: error.mensaje });
    }
    console.error(error);
    res.status(500).json({ ok: false, mensaje: 'Error al obtener citas' });
  }
};

// GET /api/barbero/citas/historial?estado=&fecha_desde=&fecha_hasta=&page=&limit=
export const getHistorialCitas = async (req, res) => {
  try {
    const barberoId = await getBarberoIdSeguro(req.user.id);
    const resultado = await BarberoModel.getHistorialCitas(barberoId, req.query);

    res.json({ ok: true, ...resultado });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ ok: false, mensaje: error.mensaje });
    }
    console.error(error);
    res.status(500).json({ ok: false, mensaje: 'Error al obtener historial' });
  }
};

// GET /api/barbero/resumen
export const getResumen = async (req, res) => {
  try {
    const barberoId = await getBarberoIdSeguro(req.user.id);
    const resumen = await BarberoModel.getResumen(barberoId);

    res.json({ ok: true, data: resumen });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ ok: false, mensaje: error.mensaje });
    }
    console.error(error);
    res.status(500).json({ ok: false, mensaje: 'Error al obtener resumen' });
  }
};

// ─── HORARIOS ─────────────────────────────────────────────────────────────

// GET /api/barbero/horarios
export const getHorarios = async (req, res) => {
  try {
    const barberoId = await getBarberoIdSeguro(req.user.id);
    const horarios = await BarberoModel.getHorarios(barberoId);

    res.json({ ok: true, data: horarios });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ ok: false, mensaje: error.mensaje });
    }
    console.error(error);
    res.status(500).json({ ok: false, mensaje: 'Error al obtener horarios' });
  }
};

// PUT /api/barbero/horarios
// Body: { horarios: [{ dia_semana, hora_inicio, hora_fin, activo }] }
export const updateHorarios = async (req, res) => {
  const { horarios } = req.body;

  if (!Array.isArray(horarios) || horarios.length === 0) {
    return res.status(400).json({
      ok: false,
      mensaje: 'Envía un array de horarios',
    });
  }

  // Validaciones
  for (const h of horarios) {
    if (h.dia_semana < 0 || h.dia_semana > 6) {
      return res.status(400).json({
        ok: false,
        mensaje: `dia_semana inválido: ${h.dia_semana}. Debe ser 0–6`,
      });
    }
    if (!h.hora_inicio || !h.hora_fin) {
      return res.status(400).json({
        ok: false,
        mensaje: 'hora_inicio y hora_fin son obligatorios',
      });
    }
    if (h.hora_inicio >= h.hora_fin) {
      return res.status(400).json({
        ok: false,
        mensaje: `hora_inicio debe ser menor que hora_fin (día ${h.dia_semana})`,
      });
    }
  }

  try {
    const barberoId = await getBarberoIdSeguro(req.user.id);
    const resultado = await BarberoModel.upsertHorarios(barberoId, horarios);

    res.json({
      ok: true,
      mensaje: 'Horarios guardados correctamente',
      data: resultado,
    });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ ok: false, mensaje: error.mensaje });
    }
    console.error(error);
    res.status(500).json({ ok: false, mensaje: 'Error al guardar horarios' });
  }
};

// PATCH /api/barbero/horarios/:diaSemana/toggle
// Body: { activo: true/false }
export const toggleDiaHorario = async (req, res) => {
  const { diaSemana } = req.params;
  const { activo } = req.body;

  if (typeof activo !== 'boolean') {
    return res.status(400).json({ ok: false, mensaje: '"activo" debe ser true o false' });
  }

  try {
    const barberoId = await getBarberoIdSeguro(req.user.id);
    const actualizado = await BarberoModel.toggleDia(barberoId, Number(diaSemana), activo);

    if (!actualizado) {
      return res.status(404).json({ ok: false, mensaje: 'Día no encontrado en el horario' });
    }

    res.json({
      ok: true,
      mensaje: `Día ${activo ? 'activado' : 'desactivado'}`,
      data: actualizado,
    });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ ok: false, mensaje: error.mensaje });
    }
    console.error(error);
    res.status(500).json({ ok: false, mensaje: 'Error al actualizar día' });
  }
};

// DELETE /api/barbero/horarios/:diaSemana
export const deleteDiaHorario = async (req, res) => {
  const { diaSemana } = req.params;

  try {
    const barberoId = await getBarberoIdSeguro(req.user.id);
    const eliminado = await BarberoModel.deleteDia(barberoId, Number(diaSemana));

    if (!eliminado) {
      return res.status(404).json({ ok: false, mensaje: 'Día no encontrado' });
    }

    res.json({ ok: true, mensaje: 'Día eliminado del horario', data: eliminado });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ ok: false, mensaje: error.mensaje });
    }
    console.error(error);
    res.status(500).json({ ok: false, mensaje: 'Error al eliminar día' });
  }
};

// PATCH /api/barbero/:id/perfil
// Uso admin: actualiza el perfil de un barbero específico.
export const updatePerfilAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    const actualizado = await BarberoModel.updatePerfil(id, req.body);

    if (!actualizado) {
      return res.status(400).json({ ok: false, mensaje: 'Barbero no encontrado o sin cambios para actualizar' });
    }

    res.json({ ok: true, mensaje: 'Perfil de barbero actualizado', data: actualizado });
  } catch (error) {
    console.error(error);
    res.status(500).json({ ok: false, mensaje: 'Error al actualizar perfil del barbero' });
  }
};
