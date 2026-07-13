import { query } from '../config/database.js';

class LocalModel {

  static async getAll(activo = null) {
    const params = [];
    let where = '';
    if (activo !== null) {
      params.push(activo);
      where = `WHERE activo = $1`;
    }

    const { rows } = await query(
      `SELECT * FROM locales
       ${where}
       ORDER BY es_principal DESC, nombre ASC`,
      params
    );
    return rows;
  }

  static async getById(id) {
    const { rows } = await query('SELECT * FROM locales WHERE id = $1', [id]);
    return rows[0] || null;
  }

  static async create(data) {
    const {
      nombre, direccion, ciudad, estado, codigo_postal, telefono, email,
      latitud, longitud, hora_apertura, hora_cierre, es_principal,
    } = data;

    const { rows } = await query(
      `INSERT INTO locales
        (nombre, direccion, ciudad, estado, codigo_postal, telefono, email,
         latitud, longitud, hora_apertura, hora_cierre, es_principal)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING *`,
      [
        nombre, direccion, ciudad || null, estado || null, codigo_postal || null,
        telefono || null, email || null, latitud || null, longitud || null,
        hora_apertura || '09:00:00', hora_cierre || '19:00:00', es_principal || false,
      ]
    );
    return rows[0];
  }

  static async update(id, data) {
    const campos = [
      'nombre', 'direccion', 'ciudad', 'estado', 'codigo_postal', 'telefono',
      'email', 'latitud', 'longitud', 'hora_apertura', 'hora_cierre',
      'activo', 'es_principal',
    ];

    const sets = [];
    const params = [];
    let i = 1;

    for (const campo of campos) {
      if (data[campo] !== undefined) {
        sets.push(`${campo} = $${i}`);
        params.push(data[campo]);
        i += 1;
      }
    }

    if (sets.length === 0) return null;

    sets.push('updated_at = CURRENT_TIMESTAMP');
    params.push(id);

    const { rows } = await query(
      `UPDATE locales SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
      params
    );
    return rows[0] || null;
  }

  // Cuántos barberos activos dependen de este local (para bloquear soft-delete)
  static async contarBarberosActivos(id) {
    const { rows } = await query(
      'SELECT COUNT(*)::int AS total FROM barberos WHERE local_id = $1 AND activo = true',
      [id]
    );
    return rows[0].total;
  }

  static async softDelete(id) {
    const { rows } = await query(
      `UPDATE locales SET activo = false, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 RETURNING *`,
      [id]
    );
    return rows[0] || null;
  }
}

export default LocalModel;