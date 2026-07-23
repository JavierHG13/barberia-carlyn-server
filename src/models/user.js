import { pool } from "../config/database.js";

class User {
  static async findByEmail(email) {
    const result = await pool.query(
      `SELECT u.*, r.nombre AS rol 
       FROM usuarios u 
       JOIN roles r ON u.rol_id = r.id 
       WHERE u.email = $1 AND u.activo = true`,
      [email]
    );
    return result.rows[0];
  }

  static async findById(id) {
    const result = await pool.query(
      `SELECT u.*, r.nombre AS rol 
       FROM usuarios u 
       JOIN roles r ON u.rol_id = r.id 
       WHERE u.id = $1 AND u.activo = true`,
      [id]
    );
    return result.rows[0];
  }

 
  static async create({ nombre, email, telefono, password, idRol = 3 }) {
    const result = await pool.query(
      `INSERT INTO usuarios(nombre, email, telefono, password, rol_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [nombre, email, telefono, password, idRol]
    );
    return result.rows[0];
  }

  static async update(id, { password }) {
    const result = await pool.query(
      'UPDATE usuarios SET password = $1 WHERE id = $2 RETURNING *',
      [password, id]
    );
    return result.rows[0];
  }

  static async updateProfile(id, { nombre, telefono, foto }) {
    const updates = [];
    const values = [];
    let index = 1;

    if (nombre !== undefined) {
      updates.push(`nombre = $${index++}`);
      values.push(nombre);
    }

    if (telefono !== undefined) {
      updates.push(`telefono = $${index++}`);
      values.push(telefono || null);
    }

    if (foto !== undefined) {
      updates.push(`foto = $${index++}`);
      values.push(foto || null);
    }

    if (updates.length === 0) {
      return this.findById(id);
    }

    values.push(id);
    const result = await pool.query(
      `UPDATE usuarios
       SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP
       WHERE id = $${index}
       RETURNING id, nombre, email, telefono, rol_id, foto, activo, created_at, updated_at`,
      values
    );

    const updated = result.rows[0];
    if (!updated) return null;

    return this.findById(updated.id);
  }

  static async findAll({ limit = 10, offset = 0, search = '' }) {
    const values = [];
    let index = 1;
    let whereClause = '';

    if (search) {
      whereClause = `WHERE nombre ILIKE $${index} OR email ILIKE $${index}`;
      values.push(`%${search}%`);
      index += 1;
    }

    values.push(limit, offset);

    const result = await pool.query(
      `SELECT id, nombre, email, telefono, rol_id, created_at
       FROM usuarios
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${index} OFFSET $${index + 1}`,
      values
    );

    return result.rows;
  }

  static async countAll({ search = '' }) {
    const values = [];
    let whereClause = '';

    if (search) {
      whereClause = 'WHERE nombre ILIKE $1 OR email ILIKE $1';
      values.push(`%${search}%`);
    }

    const result = await pool.query(
      `SELECT COUNT(*)::INT AS total
       FROM usuarios
       ${whereClause}`,
      values
    );

    return result.rows[0].total;
  }

  static async findByIdAdmin(id) {
    const result = await pool.query(
      `SELECT id, nombre, email, telefono, id_rol, created_at
       FROM usuarios
       WHERE id = $1`,
      [id]
    );

    return result.rows[0];
  }

  static async updateRole(id, idRol) {
    const result = await pool.query(
      `UPDATE usuarios
       SET rol_id = $1
       WHERE id = $2
       RETURNING id, nombre, email, telefono, rol_id, created_at`,
      [idRol, id]
    );

    return result.rows[0];
  }

  static async deleteById(id) {
    const result = await pool.query(
      'DELETE FROM usuarios WHERE id = $1 RETURNING id',
      [id]
    );

    return result.rows[0];
  }
}

export default User;
