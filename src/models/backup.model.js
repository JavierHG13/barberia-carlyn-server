import { query } from '../config/database.js';

class Backup {

  static getAllTables = async () => {
    const sql = `
      SELECT table_schema, table_name
      FROM information_schema.tables
      WHERE table_type = 'BASE TABLE'
      AND table_schema NOT IN ('pg_catalog', 'information_schema')
      ORDER BY table_schema, table_name
    `;
    const result = await query(sql);
    return result.rows;
  };

  static async create(data) {
    const {
      nombre_archivo,
      tipo,
      tamaño_bytes,
      tamaño_legible,
      url_descarga,
      cloud_key,
      cloud_provider = 'cloudinary',
      descripcion,
      usuario_id,
      configuracion_id = null,
      metadata,
      expires_at,
      log_url = null,
      log_cloud_key = null,
    } = data;

    const result = await query(
      `INSERT INTO tbl_backups
         (nombre_archivo, tipo, tamaño_bytes, tamaño_legible, url_descarga,
          cloud_key, cloud_provider, descripcion, usuario_id, configuracion_id,
          metadata, expires_at, estado, log_url, log_cloud_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'Completado',$13,$14)
       RETURNING *`,
      [
        nombre_archivo, tipo, tamaño_bytes, tamaño_legible, url_descarga,
        cloud_key, cloud_provider, descripcion, usuario_id, configuracion_id,
        metadata ? JSON.stringify(metadata) : null, expires_at,
        log_url, log_cloud_key,
      ]
    );
    return result.rows[0];
  }

  static async updateLastBackupStatus(id, estado, error = null) {
    const result = await query(
      `UPDATE tbl_backup_configuracion
       SET ultimo_respaldo  = CURRENT_TIMESTAMP,
           total_respaldos  = CASE WHEN $2 = 'exitoso' THEN total_respaldos + 1 ELSE total_respaldos END,
           ultimo_estado    = $2,
           ultimo_error     = $3
       WHERE id = $1
       RETURNING *`,
      [id, estado, error]
    );
    return result.rows[0];
  }

  static async updateNextBackup(id, proximo_respaldo) {
    const result = await query(
      'UPDATE tbl_backup_configuracion SET proximo_respaldo = $1 WHERE id = $2 RETURNING *',
      [proximo_respaldo, id]
    );
    return result.rows[0];
  }

  static async findAll(filters = {}) {
    const { tipo, limit = 50, offset = 0 } = filters;

    let queryText = `
      SELECT
        b.*,
        u.nombre AS usuario_nombre,
        u.email  AS usuario_email,
        c.nombre AS configuracion_nombre
      FROM tbl_backups b
      LEFT JOIN usuarios               u ON b.usuario_id       = u.id
      LEFT JOIN tbl_backup_configuracion c ON b.configuracion_id = c.id
      WHERE 1=1
    `;
    const params = [];
    let n = 1;

    if (tipo) { queryText += ` AND b.tipo = $${n++}`; params.push(tipo); }

    queryText += ` ORDER BY b.created_at DESC LIMIT $${n} OFFSET $${n + 1}`;
    params.push(limit, offset);

    const result = await query(queryText, params);
    return result.rows;
  }

  static async findById(id) {
    const result = await query(
      `SELECT
         b.*,
         u.nombre AS usuario_nombre,
         u.email  AS usuario_email,
         c.nombre AS configuracion_nombre
       FROM tbl_backups b
       LEFT JOIN usuarios               u ON b.usuario_id       = u.id
       LEFT JOIN tbl_backup_configuracion c ON b.configuracion_id = c.id
       WHERE b.id = $1`,
      [id]
    );
    return result.rows[0];
  }

  static async delete(id) {
    const result = await query(
      'DELETE FROM tbl_backups WHERE id = $1 RETURNING *', [id]
    );
    return result.rows[0];
  }

  static async deleteExpired() {
    const result = await query(
      `DELETE FROM tbl_backups
       WHERE expires_at IS NOT NULL AND expires_at < CURRENT_TIMESTAMP
       RETURNING *`
    );
    return result.rows;
  }

  static async getStats() {
    const result = await query(`
      SELECT
        COUNT(*)                                           AS total_backups,
        COUNT(CASE WHEN tipo = 'Manual'     THEN 1 END)   AS manuales,
        COUNT(CASE WHEN tipo = 'Automatico' THEN 1 END)   AS automaticos,
        SUM(tamaño_bytes)                                  AS tamaño_total_bytes,
        MAX(created_at)                                    AS ultimo_backup,
        MIN(created_at)                                    AS primer_backup
      FROM tbl_backups
    `);
    return result.rows[0];
  }

  static async getRecent(limit = 10) {
    const result = await query(
      `SELECT
         b.*,
         u.nombre AS usuario_nombre,
         c.nombre AS configuracion_nombre
       FROM tbl_backups b
       LEFT JOIN usuarios               u ON b.usuario_id       = u.id
       LEFT JOIN tbl_backup_configuracion c ON b.configuracion_id = c.id
       ORDER BY b.created_at DESC
       LIMIT $1`,
      [limit]
    );
    return result.rows;
  }

  static async count(filters = {}) {
    const { tipo } = filters;
    let queryText = 'SELECT COUNT(*) AS total FROM tbl_backups WHERE 1=1';
    const params = [];
    if (tipo) { queryText += ' AND tipo = $1'; params.push(tipo); }
    const result = await query(queryText, params);
    return parseInt(result.rows[0].total);
  }

  static async updateStatus(id, estado) {
    const result = await query(
      'UPDATE tbl_backups SET estado = $1 WHERE id = $2 RETURNING *',
      [estado, id]
    );
    return result.rows[0];
  }
}

// ─────────────────────────────────────────────────────────────
// Configuración de Backups automáticos
// ─────────────────────────────────────────────────────────────
class BackupConfig {
  static async findAll() {
    const result = await query(
      'SELECT * FROM tbl_backup_configuracion ORDER BY created_at DESC'
    );
    return result.rows;
  }

  static async findById(id) {
    const result = await query(
      'SELECT * FROM tbl_backup_configuracion WHERE id = $1', [id]
    );
    return result.rows[0];
  }

  static async findActive() {
    const result = await query(
      'SELECT * FROM tbl_backup_configuracion WHERE activo = true'
    );
    return result.rows;
  }

  static async create(data) {
    const {
      nombre, frecuencia, hora_ejecucion, dia_semana, dia_mes,
      retencion_dias, incluir_tablas, excluir_tablas,
      notificar_email, emails_notificacion, cloud_folder, descripcion,
    } = data;

    const result = await query(
      `INSERT INTO tbl_backup_configuracion
         (nombre, frecuencia, hora_ejecucion, dia_semana, dia_mes, retencion_dias,
          incluir_tablas, excluir_tablas, notificar_email, emails_notificacion,
          cloud_folder, descripcion)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING *`,
      [nombre, frecuencia, hora_ejecucion, dia_semana, dia_mes, retencion_dias,
        incluir_tablas, excluir_tablas, notificar_email, emails_notificacion,
        cloud_folder, descripcion]
    );
    return result.rows[0];
  }

  static async update(id, data) {
    const updates = [];
    const params = [];
    let n = 1;

    Object.entries(data).forEach(([key, val]) => {
      if (val !== undefined) { updates.push(`${key} = $${n++}`); params.push(val); }
    });

    if (!updates.length) return null;
    params.push(id);

    const result = await query(
      `UPDATE tbl_backup_configuracion SET ${updates.join(', ')} WHERE id = $${n} RETURNING *`,
      params
    );
    return result.rows[0];
  }

  static async updateLastBackup(id) {
    const result = await query(
      `UPDATE tbl_backup_configuracion
       SET ultimo_respaldo = CURRENT_TIMESTAMP,
           total_respaldos = total_respaldos + 1
       WHERE id = $1 RETURNING *`,
      [id]
    );
    return result.rows[0];
  }

  static async delete(id) {
    const result = await query(
      'DELETE FROM tbl_backup_configuracion WHERE id = $1 RETURNING *', [id]
    );
    return result.rows[0];
  }

  static async toggleActive(id, activo) {
    const result = await query(
      'UPDATE tbl_backup_configuracion SET activo = $1 WHERE id = $2 RETURNING *',
      [activo, id]
    );
    return result.rows[0];
  }
}

// ─────────────────────────────────────────────────────────────
// Registros de ejecuciones de VACUUM
// ─────────────────────────────────────────────────────────────
class Vacuum {
  static async create(data) {
    const {
      configuracion_id = null, tipo = 'Manual',
      tablas = [],
      estado, duracion_ms, log_url, log_cloud_key,
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
       LEFT JOIN usuarios                  u ON v.usuario_id       = u.id
       LEFT JOIN tbl_vacuum_configuracion  c ON v.configuracion_id = c.id
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
       LEFT JOIN usuarios                  u ON v.usuario_id       = u.id
       LEFT JOIN tbl_vacuum_configuracion  c ON v.configuracion_id = c.id
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

// ─────────────────────────────────────────────────────────────
// Configuración de VACUUM automático
// ─────────────────────────────────────────────────────────────
class VacuumConfig {
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

  static async createConfig(data) {
    const {
      nombre,
      frecuencia,
      hora_ejecucion,
      dia_semana = null,
      dia_mes = null,
      tablas = [],
      vacuum_analyze = true,
      vacuum_verbose = false,
      notificar_email = false,
      emails_notificacion = [],
      descripcion = null,
    } = data;

    const result = await query(
      `INSERT INTO tbl_vacuum_configuracion
       (nombre, frecuencia, hora_ejecucion, dia_semana, dia_mes,
        tablas, vacuum_analyze, vacuum_verbose,
        notificar_email, emails_notificacion, descripcion)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING *`,
      [
        nombre, frecuencia, hora_ejecucion, dia_semana, dia_mes,
        tablas, vacuum_analyze, vacuum_verbose,
        notificar_email, emails_notificacion, descripcion
      ]
    );

    return result.rows[0];
  }

  static async update(id, data) {
    const updates = [];
    const params = [];
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

export { Backup, BackupConfig, Vacuum, VacuumConfig };