import { pool } from '../config/database.js';

const APPOINTMENT_SELECT = `
  c.id,
  c.fecha,
  c.hora_inicio,
  c.hora_fin,
  c.notas,
  c.recordatorio_enviado,
  c.motivo_cancelacion,
  c.monto_pagado,
  c.created_at,
  c.updated_at,

  -- Cliente
  u.id           AS cliente_id,
  u.nombre       AS cliente_nombre,
  u.telefono     AS cliente_telefono,
  u.email        AS cliente_email,

  -- Barbero: nombre viene de usuarios a traves de barberos.usuario_id
  b.id                  AS barbero_id,
  b.especialidad        AS barbero_especialidad,
  ub.id                 AS barbero_usuario_id,
  ub.nombre             AS barbero_nombre,
  ub.telefono           AS barbero_telefono,

  -- Servicio
  s.id           AS servicio_id,
  s.nombre       AS servicio_nombre,
  s.duracion     AS servicio_duracion,
  s.precio       AS servicio_precio,

  -- Estado
  e.id           AS estado_id,
  e.nombre       AS estado_nombre,

  -- Método de pago
  mp.id          AS metodo_pago_id,
  mp.nombre      AS metodo_pago_nombre,

  -- Local (NUEVO)
  l.id           AS local_id,
  l.nombre       AS local_nombre,
  l.direccion    AS local_direccion
`;

const APPOINTMENT_JOINS = `
  FROM citas c
  LEFT JOIN usuarios     u  ON u.id  = c.cliente_id
  LEFT JOIN barberos     b  ON b.id  = c.barbero_id
  LEFT JOIN usuarios     ub ON ub.id = b.usuario_id
  LEFT JOIN tbl_servicios    s  ON s.id  = c.servicio_id
  LEFT JOIN estados_cita e  ON e.id  = c.estado_id
  LEFT JOIN metodos_pago mp ON mp.id = c.metodo_pago_id
  LEFT JOIN locales      l  ON l.id  = c.local_id
`;

// Map from camelCase keys to DB column names (only columns that live in citas)
const APPOINTMENT_UPDATE_MAP = {
  clienteId:          'cliente_id',
  barberoId:          'barbero_id',
  servicioId:         'servicio_id',
  localId:            'local_id', // NUEVO
  fecha:              'fecha',
  horaInicio:         'hora_inicio',
  horaFin:            'hora_fin',
  estadoId:           'estado_id',
  notas:              'notas',
  metodoPagoId:       'metodo_pago_id',
  montoPagado:        'monto_pagado',
  recordatorioEnviado:'recordatorio_enviado',
  motivoCancelacion:  'motivo_cancelacion',
};

const normalizeRole = (role) => String(role || '').trim().toLowerCase();

/**
 * Build a WHERE clause from filter options.
 * @param {object} filters
 * @param {number} [startIndex=1]
 */
const buildWhereClause = (
  { q, telefono, fechaInicio, fechaFin, estadoId, barberoId, clienteId, localId, scope },
  startIndex = 1
) => {
  const conditions = [];
  const values = [];
  let idx = startIndex;

  if (q) {
    conditions.push(`(
      u.nombre     ILIKE $${idx}
      OR u.telefono ILIKE $${idx}
      OR COALESCE(u.email, '') ILIKE $${idx}
      OR s.nombre  ILIKE $${idx}
      OR ub.nombre ILIKE $${idx}
    )`);
    values.push(`%${q}%`);
    idx += 1;
  }

  if (telefono) {
    conditions.push(`u.telefono ILIKE $${idx}`);
    values.push(`%${telefono}%`);
    idx += 1;
  }

  if (fechaInicio) {
    conditions.push(`c.fecha >= $${idx}`);
    values.push(fechaInicio);
    idx += 1;
  }

  if (fechaFin) {
    conditions.push(`c.fecha <= $${idx}`);
    values.push(fechaFin);
    idx += 1;
  }

  if (estadoId) {
    conditions.push(`c.estado_id = $${idx}`);
    values.push(estadoId);
    idx += 1;
  }

  if (barberoId) {
    conditions.push(`c.barbero_id = $${idx}`);
    values.push(barberoId);
    idx += 1;
  }

  if (clienteId) {
    conditions.push(`c.cliente_id = $${idx}`);
    values.push(clienteId);
    idx += 1;
  }

  // NUEVO: filtro por local
  if (localId) {
    conditions.push(`c.local_id = $${idx}`);
    values.push(localId);
    idx += 1;
  }

  if (scope === 'proximas') {
    conditions.push(`(
      c.fecha > CURRENT_DATE
      OR (c.fecha = CURRENT_DATE AND c.hora_fin >= CURRENT_TIME)
    )`);
    conditions.push(`LOWER(COALESCE(e.nombre, '')) NOT IN ('completada', 'cancelada', 'no_asistio', 'no asistio')`);
  }

  if (scope === 'historial') {
    conditions.push(`(
      c.fecha < CURRENT_DATE
      OR (c.fecha = CURRENT_DATE AND c.hora_fin < CURRENT_TIME)
      OR LOWER(COALESCE(e.nombre, '')) IN ('completada', 'cancelada', 'no_asistio', 'no asistio')
    )`);
  }

  return {
    whereClause: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
    values,
    nextIndex: idx,
  };
};

class Appointment {
  // ─── Queries ──────────────────────────────────────────────────────────────

  static async findById(id) {
    const result = await pool.query(
      `SELECT ${APPOINTMENT_SELECT}
       ${APPOINTMENT_JOINS}
       WHERE c.id = $1`,
      [id]
    );
    return result.rows[0] ?? null;
  }

  /**
   * Check whether a barbero already has a cita that overlaps the given
   * time window (with an optional break buffer around existing citas).
   *
   * @param {object} params
   * @param {number}      params.barberoId
   * @param {string}      params.fecha          - 'YYYY-MM-DD'
   * @param {string}      params.horaInicio     - 'HH:MM' or 'HH:MM:SS'
   * @param {string}      params.horaFin        - 'HH:MM' or 'HH:MM:SS'
   * @param {number}      [params.breakMinutes=10]
   * @param {number|null} [params.excludeId=null]
   * @param {number[]}    [params.cancelledEstadoIds=[]]  IDs that mean "cancelled"
   */
  static async hasConflict({
    barberoId,
    fecha,
    horaInicio,
    horaFin,
    breakMinutes = 10,
    excludeId = null,
    cancelledEstadoIds = [],
  }) {
    const values = [barberoId, fecha, horaInicio, horaFin, `${breakMinutes} minutes`];
    let idx = 6;

    let query = `
      SELECT c.id
      FROM   citas c
      WHERE  c.barbero_id = $1
        AND  c.fecha      = $2
        AND  NOT (
               c.hora_fin   <= ($3::time - $5::interval)
               OR c.hora_inicio >= ($4::time + $5::interval)
             )
    `;

    if (cancelledEstadoIds.length > 0) {
      query += ` AND c.estado_id NOT IN (${cancelledEstadoIds.map(() => `$${idx++}`).join(', ')})`;
      values.push(...cancelledEstadoIds);
    }

    if (excludeId) {
      query += ` AND c.id <> $${idx++}`;
      values.push(excludeId);
    }

    query += ' LIMIT 1';

    const result = await pool.query(query, values);
    return result.rows[0] ?? null;
  }

  static async create({
    clienteId,
    barberoId,
    servicioId,
    localId = null, // NUEVO
    fecha,
    horaInicio,
    horaFin,
    estadoId,
    notas = null,
    metodoPagoId = null,
    montoPagado = null,
    recordatorioEnviado = false,
    motivoCancelacion = null,
  }) {
    const result = await pool.query(
      `INSERT INTO citas
         (cliente_id, barbero_id, servicio_id, local_id, fecha, hora_inicio, hora_fin,
          estado_id, notas, metodo_pago_id, monto_pagado,
          recordatorio_enviado, motivo_cancelacion)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING id`,
      [
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
        recordatorioEnviado,
        motivoCancelacion,
      ]
    );

    // Return the full row with all joins
    return this.findById(result.rows[0].id);
  }

  static async updateById(id, updates) {
    const fields = [];
    const values = [];
    let idx = 1;

    for (const [key, value] of Object.entries(updates)) {
      if (!(key in APPOINTMENT_UPDATE_MAP)) continue;
      fields.push(`${APPOINTMENT_UPDATE_MAP[key]} = $${idx++}`);
      values.push(value);
    }

    if (fields.length === 0) {
      return this.findById(id);
    }

    fields.push('updated_at = NOW()');
    values.push(id);

    await pool.query(
      `UPDATE citas
       SET    ${fields.join(', ')}
       WHERE  id = $${idx}`,
      values
    );

    return this.findById(id);
  }

  static async search({
    q = '',
    telefono = '',
    fechaInicio = null,
    fechaFin = null,
    estadoId = null,
    barberoId = null,
    clienteId = null,
    localId = null, // NUEVO
    scope = null,
    limit = 10,
    offset = 0,
  }) {
    const filters = buildWhereClause({ q, telefono, fechaInicio, fechaFin, estadoId, barberoId, clienteId, localId, scope });
    const limitIdx  = filters.nextIndex;
    const offsetIdx = filters.nextIndex + 1;
    const orderBy = scope === 'historial'
      ? 'ORDER BY c.fecha DESC, c.hora_inicio DESC'
      : 'ORDER BY c.fecha ASC, c.hora_inicio ASC';

    const result = await pool.query(
      `SELECT ${APPOINTMENT_SELECT}
       ${APPOINTMENT_JOINS}
       ${filters.whereClause}
       ${orderBy}
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      [...filters.values, limit, offset]
    );

    return result.rows;
  }

  static async countSearch({
    q = '',
    telefono = '',
    fechaInicio = null,
    fechaFin = null,
    estadoId = null,
    barberoId = null,
    clienteId = null,
    localId = null, // NUEVO
    scope = null,
  }) {
    const filters = buildWhereClause({ q, telefono, fechaInicio, fechaFin, estadoId, barberoId, clienteId, localId, scope });

    const result = await pool.query(
      `SELECT COUNT(*)::INT AS total
       ${APPOINTMENT_JOINS}
       ${filters.whereClause}`,
      filters.values
    );

    return result.rows[0].total;
  }

  /**
   * Find all appointments with optional role-based filtering.
   *
   * @param {object} filters
   * @param {string}      filters.userRole  - 'cliente' | 'barbero' | 'admin'
   * @param {number}      filters.userId    - ID of the authenticated user
   * @param {string}      [filters.fecha]
   * @param {number|null} [filters.barberoId]
   * @param {number|null} [filters.clienteId]
   * @param {number|null} [filters.estadoId]
   * @param {number|null} [filters.localId]  NUEVO
   */
  static async findAll({ userRole, userId, fecha = null, barberoId = null, clienteId = null, estadoId = null, localId = null } = {}) {
    const conditions = [];
    const values = [];
    let idx = 1;
    const normalizedRole = normalizeRole(userRole);

    // Role-based scope
    if (normalizedRole === 'cliente') {
      conditions.push(`c.cliente_id = $${idx++}`);
      values.push(userId);
    } else if (normalizedRole === 'barbero') {
      // Resolve the barberos.id from the usuarios.id
      const barberoResult = await pool.query(
        'SELECT id FROM barberos WHERE usuario_id = $1 LIMIT 1',
        [userId]
      );
      if (barberoResult.rows.length > 0) {
        conditions.push(`c.barbero_id = $${idx++}`);
        values.push(barberoResult.rows[0].id);
      }
    }
    // 'admin' / superadmin → no scope restriction

    if (fecha) {
      conditions.push(`c.fecha = $${idx++}`);
      values.push(fecha);
    }

    if (barberoId) {
      conditions.push(`c.barbero_id = $${idx++}`);
      values.push(barberoId);
    }

    if (clienteId) {
      conditions.push(`c.cliente_id = $${idx++}`);
      values.push(clienteId);
    }

    if (estadoId) {
      conditions.push(`c.estado_id = $${idx++}`);
      values.push(estadoId);
    }

    // NUEVO: filtro por local (dashboard admin por sucursal)
    if (localId) {
      conditions.push(`c.local_id = $${idx++}`);
      values.push(localId);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await pool.query(
      `SELECT ${APPOINTMENT_SELECT}
       ${APPOINTMENT_JOINS}
       ${whereClause}
       ORDER BY c.fecha DESC, c.hora_inicio DESC`,
      values
    );

    return result.rows;
  }

  /**
   * Cancel a cita by setting its estado to the given cancelledEstadoId
   * and recording the motivo_cancelacion.
   *
   * @param {number} id
   * @param {string} motivo
   * @param {number} cancelledEstadoId  - e.g. 3
   */
  static async cancel(id, motivo, cancelledEstadoId) {
    await pool.query(
      `UPDATE citas
       SET    estado_id           = $1,
              motivo_cancelacion  = $2,
              updated_at          = NOW()
       WHERE  id = $3`,
      [cancelledEstadoId, motivo || 'Sin motivo especificado', id]
    );
    return this.findById(id);
  }

  /**
   * Mark a cita as completed, recording the payment method.
   *
   * @param {number} id
   * @param {number} completedEstadoId  - e.g. 2
   * @param {number|null} metodoPagoId
   */
  static async complete(id, completedEstadoId, metodoPagoId = null) {
    await pool.query(
      `UPDATE citas
       SET    estado_id      = $1,
              metodo_pago_id = $2,
              updated_at     = NOW()
       WHERE  id = $3`,
      [completedEstadoId, metodoPagoId, id]
    );
    return this.findById(id);
  }

  /**
   * Mark past pending/confirmed citas as "no_asistio".
   * Relies on a state whose nombre = 'no_asistio' existing in estados_cita,
   * or you can pass the ID directly.
   *
   * @param {string} fechaLimite  - YYYY-MM-DD; citas before this date are affected
   * @param {number} noShowEstadoId
   * @param {number[]} pendingEstadoIds  - IDs considered "open" (e.g. [1, 4])
   * @returns {number} number of rows updated
   */
  static async markNoShow(fechaLimite, noShowEstadoId, pendingEstadoIds = []) {
    if (pendingEstadoIds.length === 0) return 0;

    const placeholders = pendingEstadoIds.map((_, i) => `$${i + 3}`).join(', ');

    const result = await pool.query(
      `UPDATE citas
       SET    estado_id  = $1,
              updated_at = NOW()
       WHERE  fecha      < $2
         AND  estado_id IN (${placeholders})`,
      [noShowEstadoId, fechaLimite, ...pendingEstadoIds]
    );

    return result.rowCount;
  }

  static async getCalendar({ from, to, barberoId = null, estadoId = null, localId = null }) {
    const conditions = ['c.fecha >= $1', 'c.fecha <= $2'];
    const values = [from, to];
    let idx = 3;

    if (barberoId) {
      conditions.push(`c.barbero_id = $${idx++}`);
      values.push(barberoId);
    }

    if (estadoId) {
      conditions.push(`c.estado_id = $${idx++}`);
      values.push(estadoId);
    }

    // NUEVO
    if (localId) {
      conditions.push(`c.local_id = $${idx++}`);
      values.push(localId);
    }

    const result = await pool.query(
      `SELECT ${APPOINTMENT_SELECT}
       ${APPOINTMENT_JOINS}
       WHERE  ${conditions.join(' AND ')}
       ORDER BY c.fecha ASC, c.hora_inicio ASC`,
      values
    );

    return result.rows;
  }


  
}

export default Appointment;
