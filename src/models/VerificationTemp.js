import { pool } from "../config/database.js";

class VerificationTemp {
  static async create({
    correoElectronico,
    nombreCompleto,
    telefono,
    contrasena,
    codigoVerificacion,
    tipo,
    userId = null,
    verificado = false,
    canal = 'email',
  }) {
    const result = await pool.query(
      `INSERT INTO verificaciones_temp 
       (email, nombre, telefono, password, codigo_verificacion, tipo, user_id, verificado, canal)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [correoElectronico, nombreCompleto, telefono, contrasena, codigoVerificacion, tipo, userId, verificado, canal]
    );
    return result.rows[0];
  }

  static async findOne(correoElectronico, tipo, telefono = null) {
    if (telefono) {
      const result = await pool.query(
        `SELECT * FROM verificaciones_temp 
         WHERE telefono = $1 AND tipo = $2 
         ORDER BY created_at DESC LIMIT 1`,
        [telefono, tipo]
      );
      return result.rows[0];
    }

    const result = await pool.query(
      `SELECT * FROM verificaciones_temp 
       WHERE email = $1 AND tipo = $2 
       ORDER BY created_at DESC LIMIT 1`,
      [correoElectronico, tipo]
    );
    return result.rows[0];
  }

  static async findVerified(correoElectronico, tipo, telefono = null) {
    if (telefono) {
      const result = await pool.query(
        `SELECT * FROM verificaciones_temp 
         WHERE telefono = $1 AND tipo = $2 AND verificado = TRUE 
         ORDER BY created_at DESC LIMIT 1`,
        [telefono, tipo]
      );
      return result.rows[0];
    }

    const result = await pool.query(
      `SELECT * FROM verificaciones_temp 
       WHERE email = $1 AND tipo = $2 AND verificado = TRUE 
       ORDER BY created_at DESC LIMIT 1`,
      [correoElectronico, tipo]
    );
    return result.rows[0];
  }

  static async update(id, updates) {
    const fields = [];
    const values = [];
    let index = 1;

    const columnMap = {
      codigo_verificacion: 'codigo_verificacion',
      created_at: 'created_at',
      verificado: 'verificado',
      expira_en: 'expira_en',
      canal: 'canal',
    };

    for (const [key, value] of Object.entries(updates)) {
      const column = columnMap[key] ?? key;
      fields.push(`${column} = $${index}`);
      values.push(value);
      index++;
    }

    values.push(id);

    const result = await pool.query(
      `UPDATE verificaciones_temp SET ${fields.join(', ')} WHERE id = $${index} RETURNING *`,
      values
    );
    return result.rows[0];
  }

  static async delete(id) {
    await pool.query('DELETE FROM verificaciones_temp WHERE id = $1', [id]);
  }

  static async deleteByEmail(correoElectronico, tipo) {
    await pool.query(
      'DELETE FROM verificaciones_temp WHERE email = $1 AND tipo = $2',
      [correoElectronico, tipo]
    );
  }

  static async deleteByTelefono(telefono, tipo) {
    await pool.query(
      'DELETE FROM verificaciones_temp WHERE telefono = $1 AND tipo = $2',
      [telefono, tipo]
    );
  }

  static async cleanOldVerifications() {
    await pool.query(
      `DELETE FROM verificaciones_temp WHERE expira_en < NOW()`
    );
  }
}

export default VerificationTemp;