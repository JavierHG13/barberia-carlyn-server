import { query } from '../config/database.js';
// ─────────────────────────────────────────────────────────────
// Clase Vacuum (sin analyze/verbose)
// ─────────────────────────────────────────────────────────────
export class Vacuum {
  static async create(data) {

    console.log("Inserando registro de vacuum")
    const {
      configuracion_id = null, tipo = 'Manual',
      tablas = [], estado, duracion_ms, log_url, log_cloud_key,
      descripcion, usuario_id, metadata,
    } = data;

    const result = await query(
      
      `INSERT INTO tbl_vacuums
         (configuracion_id, tipo, tablas, estado,
          duracion_ms, log_url, log_cloud_key, descripcion, usuario_id, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [configuracion_id, tipo, tablas, estado,
        duracion_ms, log_url, log_cloud_key, descripcion, usuario_id,
        metadata ? JSON.stringify(metadata) : null]
    );
    return result.rows[0];
  }

  static async findAll({ limit = 50, offset = 0 } = {}) {
    const result = await query(
      `SELECT v.*, u.nombre AS usuario_nombre, c.nombre AS configuracion_nombre
       FROM tbl_vacuums v
       LEFT JOIN usuarios        u ON v.usuario_id       = u.id
       LEFT JOIN tbl_vacuum_configuracion c ON v.configuracion_id = c.id
       ORDER BY v.created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    return result.rows;
  }

  static async findById(id) {
    const result = await query(
      `SELECT v.*, u.nombre AS usuario_nombre, c.nombre AS configuracion_nombre
       FROM tbl_vacuums v
       LEFT JOIN usuarios        u ON v.usuario_id       = u.id
       LEFT JOIN tbl_vacuum_configuracion c ON v.configuracion_id = c.id
       WHERE v.id = $1`,
      [id]
    );
    return result.rows[0];
  }

  static async delete(id) {
    const result = await query(
      'DELETE FROM tbl_vacuums WHERE id = $1 RETURNING *', [id]
    );
    return result.rows[0];
  }
}

// ─────────────────────────────────────────
// Configuraciones de VACUUM automático
// ─────────────────────────────────────────
export class VacuumConfig {
  static async findAll() {
    const result = await query(
      'SELECT * FROM tbl_vacuum_configuracion ORDER BY created_at DESC'
    );
    return result.rows;
  }

  static async findById(id) {
    const result = await query(
      'SELECT * FROM tbl_vacuum_configuracion WHERE id = $1', [id]
    );
    return result.rows[0];
  }

  static async findActive() {
    const result = await query(
      'SELECT * FROM tbl_vacuum_configuracion WHERE activo = true'
    );
    return result.rows;
  }

  static async create(data) {

    console.log("Creando configuracion")
    const {
      nombre, descripcion, frecuencia, hora_ejecucion,
      dia_semana, dia_mes, tablas = [],
      notificar_email = false, emails_notificacion,
    } = data;

    const result = await query(
      `INSERT INTO tbl_vacuum_configuracion
         (nombre, descripcion, frecuencia, hora_ejecucion, dia_semana, dia_mes,
          tablas, notificar_email, emails_notificacion)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [nombre, descripcion, frecuencia, hora_ejecucion, dia_semana, dia_mes,
       tablas, notificar_email, emails_notificacion]
    );
    return result.rows[0];
  }

  static async update(id, data) {
    const updates = [];
    const params  = [];
    let n = 1;

    Object.entries(data).forEach(([key, val]) => {
      if (val !== undefined) { updates.push(`${key} = $${n++}`); params.push(val); }
    });

    if (!updates.length) return null;
    params.push(id);

    const result = await query(
      `UPDATE tbl_vacuum_configuracion SET ${updates.join(', ')} WHERE id = $${n} RETURNING *`,
      params
    );
    return result.rows[0];
  }

  static async toggleActive(id, activo) {
    const result = await query(
      'UPDATE tbl_vacuum_configuracion SET activo = $1 WHERE id = $2 RETURNING *',
      [activo, id]
    );
    return result.rows[0];
  }

  static async delete(id) {
    const result = await query(
      'DELETE FROM tbl_vacuum_configuracion WHERE id = $1 RETURNING *', [id]
    );
    return result.rows[0];
  }

  static async updateLastStatus(id, estado, error = null) {
    const result = await query(
      `UPDATE tbl_vacuum_configuracion
       SET ultimo_vacuum     = CURRENT_TIMESTAMP,
           total_ejecuciones = CASE WHEN $2 = 'exitoso' THEN total_ejecuciones + 1 ELSE total_ejecuciones END,
           ultimo_estado     = $2,
           ultimo_error      = $3
       WHERE id = $1 RETURNING *`,
      [id, estado, error]
    );
    return result.rows[0];
  }

  static async updateNextVacuum(id, proximo_vacuum) {
    const result = await query(
      'UPDATE tbl_vacuum_configuracion SET proximo_vacuum = $1 WHERE id = $2 RETURNING *',
      [proximo_vacuum, id]
    );
    return result.rows[0];
  }
}