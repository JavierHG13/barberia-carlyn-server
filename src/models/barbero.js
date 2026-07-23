import { query, transaction } from '../config/database.js';

class BarberoModel {

  // ─── PERFIL ──────────────────────────────────────────────────────────

  // Obtener perfil completo del barbero por su usuario_id
  static async getPerfilByUsuarioId(usuarioId) {
    const { rows } = await query(
      `SELECT
         b.id              AS barbero_id,
         b.especialidad,
         b.años_experiencia,
         b.descripcion,
         b.calificacion,
         b.activo,
         b.created_at,
         b.local_id,
         l.nombre          AS local_nombre,
         l.direccion       AS local_direccion,
         u.id              AS usuario_id,
         u.nombre,
         u.email,
         u.telefono,
         u.foto
       FROM barberos b
       JOIN usuarios u ON b.usuario_id = u.id
       LEFT JOIN locales l ON l.id = b.local_id
       WHERE b.usuario_id = $1`,
      [usuarioId]
    );
    return rows[0] || null;
  }

  // Actualizar perfil del barbero (solo campos del barbero, no del usuario)
  static async updatePerfil(barberoId, data) {
    const { especialidad, años_experiencia, descripcion } = data;

    const updates = [];
    const params = [];
    let p = 1;

    if (especialidad !== undefined) {
      updates.push(`especialidad = $${p++}`);
      params.push(especialidad);
    }
    if (años_experiencia !== undefined) {
      updates.push(`años_experiencia = $${p++}`);
      params.push(Number(años_experiencia));
    }
    if (descripcion !== undefined) {
      updates.push(`descripcion = $${p++}`);
      params.push(descripcion);
    }

    if (updates.length === 0) return null;

    params.push(barberoId);

    const { rows } = await query(
      `UPDATE barberos
       SET ${updates.join(', ')}
       WHERE id = $${p}
       RETURNING *`,
      params
    );
    return rows[0] || null;
  }

  // ─── LOCALES (NUEVO) ─────────────────────────────────────────────────

  // Fila mínima del barbero, usada por citasController para validar
  // que barbero_id / local_id sean consistentes antes de crear una cita.
  static async getById(barberoId) {
    const { rows } = await query(
      `SELECT b.id, b.activo, b.local_id, l.nombre AS local_nombre
       FROM barberos b
       LEFT JOIN locales l ON l.id = b.local_id
       WHERE b.id = $1`,
      [barberoId]
    );
    return rows[0] || null;
  }

  // Barberos activos de un local específico (para el flujo de reserva:
  // el cliente elige local -> aquí se listan solo esos barberos)
  static async getByLocalId(localId) {
    const { rows } = await query(
      `SELECT b.id AS barbero_id, b.especialidad, b.calificacion,
              b.años_experiencia, u.nombre, u.foto
       FROM barberos b
       JOIN usuarios u ON u.id = b.usuario_id
       WHERE b.local_id = $1 AND b.activo = true
       ORDER BY b.calificacion DESC`,
      [localId]
    );
    return rows;
  }

  // Reasignar un barbero a otro local (uso admin)
  static async assignLocal(barberoId, localId) {
    const { rows } = await query(
      `UPDATE barberos SET local_id = $1 WHERE id = $2 RETURNING *`,
      [localId, barberoId]
    );
    return rows[0] || null;
  }

  // ─── CITAS ───────────────────────────────────────────────────────────

  // Próximas citas del barbero (hoy en adelante, estados activos)
  static async getProximasCitas(barberoId, limit = 10) {
    const { rows } = await query(
      `SELECT
         c.id,
         c.fecha,
         c.hora_inicio,
         c.hora_fin,
         c.notas,
         c.motivo_cancelacion,
         e.nombre                  AS estado,
         s.nombre                  AS servicio,
         s.duracion,
         s.precio,
         mp.nombre                 AS metodo_pago,
         c.monto_pagado,
         l.id                      AS local_id,
         l.nombre                  AS local_nombre,
         u.id                      AS cliente_id,
         u.nombre                  AS cliente_nombre,
         u.telefono                AS cliente_telefono,
         u.foto                    AS cliente_foto
       FROM citas c
       JOIN estados_cita e  ON c.estado_id  = e.id
       JOIN tbl_servicios s ON c.servicio_id = s.id
       JOIN usuarios u      ON c.cliente_id  = u.id
       LEFT JOIN metodos_pago mp ON c.metodo_pago_id = mp.id
       LEFT JOIN locales l  ON l.id = c.local_id
       WHERE c.barbero_id = $1
         AND c.fecha >= CURRENT_DATE
         AND e.nombre IN ('Pendiente', 'Confirmada')
       ORDER BY c.fecha ASC, c.hora_inicio ASC
       LIMIT $2`,
      [barberoId, limit]
    );
    return rows;
  }

  // Historial de citas con filtros opcionales (fecha, estado, página)
  static async getHistorialCitas(barberoId, filters = {}) {
    const { estado, fecha_desde, fecha_hasta, page = 1, limit = 10 } = filters;

    let sql = `
      SELECT
        c.id,
        c.fecha,
        c.hora_inicio,
        c.hora_fin,
        c.notas,
        c.motivo_cancelacion,
        e.nombre        AS estado,
        s.nombre        AS servicio,
        s.precio,
        mp.nombre       AS metodo_pago,
        c.monto_pagado,
        l.nombre        AS local_nombre,
        u.nombre        AS cliente_nombre,
        u.telefono      AS cliente_telefono
      FROM citas c
      JOIN estados_cita e  ON c.estado_id   = e.id
      JOIN tbl_servicios s ON c.servicio_id  = s.id
      JOIN usuarios u      ON c.cliente_id   = u.id
      LEFT JOIN metodos_pago mp ON c.metodo_pago_id = mp.id
      LEFT JOIN locales l  ON l.id = c.local_id
      WHERE c.barbero_id = $1
    `;

    const params = [barberoId];
    let p = 2;

    if (estado) {
      sql += ` AND e.nombre = $${p++}`;
      params.push(estado);
    }
    if (fecha_desde) {
      sql += ` AND c.fecha >= $${p++}`;
      params.push(fecha_desde);
    }
    if (fecha_hasta) {
      sql += ` AND c.fecha <= $${p++}`;
      params.push(fecha_hasta);
    }

    // Total para paginación
    const countSql = sql.replace(
      /SELECT[\s\S]*?FROM/,
      'SELECT COUNT(*) AS total FROM'
    );
    const { rows: countRows } = await query(countSql, params);
    const total = parseInt(countRows[0].total);

    // Paginación
    const offset = (page - 1) * limit;
    sql += ` ORDER BY c.fecha DESC, c.hora_inicio DESC LIMIT $${p++} OFFSET $${p++}`;
    params.push(limit, offset);

    const { rows } = await query(sql, params);

    return {
      data: rows,
      total,
      page: Number(page),
      totalPages: Math.ceil(total / limit),
    };
  }

  // Resumen estadístico del barbero
  static async getResumen(barberoId) {
    const { rows } = await query(
      `SELECT
         COUNT(*) FILTER (WHERE e.nombre = 'Completada')                        AS completadas,
         COUNT(*) FILTER (WHERE e.nombre = 'Cancelada')                         AS canceladas,
         COUNT(*) FILTER (WHERE e.nombre = 'No_asistio')                        AS no_asistio,
         COUNT(*) FILTER (WHERE e.nombre IN ('Pendiente','Confirmada')
                            AND c.fecha >= CURRENT_DATE)                         AS proximas,
         COUNT(*) FILTER (WHERE c.fecha = CURRENT_DATE
                            AND e.nombre IN ('Pendiente','Confirmada'))           AS hoy,
         COALESCE(SUM(c.monto_pagado) FILTER (WHERE e.nombre = 'Completada'), 0) AS ingresos_total,
         COALESCE(AVG(c.monto_pagado) FILTER (WHERE e.nombre = 'Completada'), 0) AS ticket_promedio
       FROM citas c
       JOIN estados_cita e ON c.estado_id = e.id
       WHERE c.barbero_id = $1`,
      [barberoId]
    );
    return rows[0];
  }

  // ─── HORARIOS ────────────────────────────────────────────────────────

  // Obtener todos los horarios del barbero
  static async getHorarios(barberoId) {
    const { rows } = await query(
      `SELECT id, dia_semana, hora_inicio, hora_fin, activo
       FROM horarios_barbero
       WHERE barbero_id = $1
       ORDER BY dia_semana ASC`,
      [barberoId]
    );
    return rows;
  }

  // Guardar horarios completos (upsert bulk — reemplaza la semana entera)
  static async upsertHorarios(barberoId, horarios) {
    // horarios = [{ dia_semana, hora_inicio, hora_fin, activo }]
    return await transaction(async (client) => {
      const resultado = [];

      for (const h of horarios) {
        const { dia_semana, hora_inicio, hora_fin, activo = true } = h;

        const { rows } = await client.query(
          `INSERT INTO horarios_barbero
             (barbero_id, dia_semana, hora_inicio, hora_fin, activo)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (barbero_id, dia_semana)
           DO UPDATE SET
             hora_inicio = EXCLUDED.hora_inicio,
             hora_fin    = EXCLUDED.hora_fin,
             activo      = EXCLUDED.activo
           RETURNING *`,
          [barberoId, dia_semana, hora_inicio, hora_fin, activo]
        );
        resultado.push(rows[0]);
      }

      return resultado;
    });
  }

  // Activar / desactivar un día específico
  static async toggleDia(barberoId, diaSemana, activo) {
    const { rows } = await query(
      `UPDATE horarios_barbero
       SET activo = $1
       WHERE barbero_id = $2 AND dia_semana = $3
       RETURNING *`,
      [activo, barberoId, diaSemana]
    );
    return rows[0] || null;
  }

  // Eliminar un día del horario
  static async deleteDia(barberoId, diaSemana) {
    const { rows } = await query(
      `DELETE FROM horarios_barbero
       WHERE barbero_id = $1 AND dia_semana = $2
       RETURNING *`,
      [barberoId, diaSemana]
    );
    return rows[0] || null;
  }

  // NUEVO: acepta filtro opcional por localId (?localId=2)
  static async getAllBarberos(localId = null) {
    const params = [];
    let where = '';
    if (localId) {
      params.push(localId);
      where = `WHERE b.local_id = $1`;
    }

    const { rows } = await query(
      `SELECT
       b.id              AS barbero_id,
       b.especialidad,
       b.años_experiencia,
       b.descripcion,
       b.calificacion,
       b.activo,
       b.created_at,
       b.local_id,
       l.nombre          AS local_nombre,
       l.direccion       AS local_direccion,
       u.id              AS usuario_id,
       u.nombre,
       u.email,
       u.telefono,
       u.foto,
       COALESCE(
         JSON_AGG(
           JSON_BUILD_OBJECT(
             'id',          h.id,
             'dia_semana',  h.dia_semana,
             'hora_inicio', h.hora_inicio,
             'hora_fin',    h.hora_fin,
             'activo',      h.activo
           ) ORDER BY h.dia_semana
         ) FILTER (WHERE h.id IS NOT NULL),
         '[]'
       ) AS horarios
     FROM barberos b
     JOIN usuarios u ON b.usuario_id = u.id
     LEFT JOIN locales l ON l.id = b.local_id
     LEFT JOIN horarios_barbero h ON h.barbero_id = b.id
     ${where}
     GROUP BY b.id, u.id, l.id
     ORDER BY b.created_at DESC`,
      params
    );
    return rows;
  };
}

export default BarberoModel;
