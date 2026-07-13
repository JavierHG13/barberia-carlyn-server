import { query, transaction } from '../config/database.js';

class Usuario {

  // 🔍 Obtener todos los usuarios con filtros
  static async findAll(filters = {}) {
    const { rol, activo, search, page = 1, limit = 10 } = filters;

    let queryText = `
      SELECT 
        u.id,
        u.nombre,
        u.email,
        u.telefono,
        u.rol_id,
        r.nombre AS rol,
        u.foto,
        u.activo,
        u.created_at,
        u.updated_at
      FROM usuarios u
      LEFT JOIN roles r ON u.rol_id = r.id
      WHERE 1=1
    `;

    const params = [];
    let paramCount = 1;

    if (rol) {
      queryText += ` AND r.nombre = $${paramCount++}`;
      params.push(rol);
    }

    if (activo !== undefined) {
      queryText += ` AND u.activo = $${paramCount++}`;
      params.push(activo === 'true' || activo === true);
    }

    if (search) {
      queryText += ` AND (
        u.nombre ILIKE $${paramCount} 
        OR u.email ILIKE $${paramCount} 
        OR u.telefono ILIKE $${paramCount}
      )`;
      params.push(`%${search}%`);
      paramCount++;
    }

    const offset = (page - 1) * limit;

    queryText += `
      ORDER BY u.created_at DESC
      LIMIT $${paramCount++} OFFSET $${paramCount++}
    `;

    params.push(limit, offset);

    const result = await query(queryText, params);
    return result.rows;
  }

  // 🔢 Contar usuarios
  static async count(filters = {}) {
    const { rol, activo, search } = filters;

    let queryText = `
      SELECT COUNT(*) as total
      FROM usuarios u
      LEFT JOIN roles r ON u.rol_id = r.id
      WHERE 1=1
    `;

    const params = [];
    let paramCount = 1;

    if (rol) {
      queryText += ` AND r.nombre = $${paramCount++}`;
      params.push(rol);
    }

    if (activo !== undefined) {
      queryText += ` AND u.activo = $${paramCount++}`;
      params.push(activo === 'true' || activo === true);
    }

    if (search) {
      queryText += ` AND (
        u.nombre ILIKE $${paramCount} 
        OR u.email ILIKE $${paramCount}
        OR u.telefono ILIKE $${paramCount}
      )`;
      params.push(`%${search}%`);
      paramCount++;
    }

    const result = await query(queryText, params);
    return parseInt(result.rows[0].total);
  }

  // 🔍 Buscar por ID
  static async findById(id) {
    const result = await query(
      `SELECT 
        u.*,
        r.nombre AS rol,
        b.id as barbero_id,
        b.especialidad,
        b.años_experiencia,
        b.descripcion,
        b.calificacion
      FROM usuarios u
      LEFT JOIN roles r ON u.rol_id = r.id
      LEFT JOIN barberos b ON u.id = b.usuario_id
      WHERE u.id = $1`,
      [id]
    );
    return result.rows[0];
  }

  // 🔍 Buscar por email
  static async findByEmail(email) {
    const result = await query(
      `SELECT u.*, r.nombre AS rol
       FROM usuarios u
       LEFT JOIN roles r ON u.rol_id = r.id
       WHERE u.email = $1`,
      [email]
    );
    return result.rows[0];
  }

  // 🔎 Verificar duplicados
  static async existsEmailOrPhone(email, telefono) {
    const result = await query(
      'SELECT id FROM usuarios WHERE email = $1 OR telefono = $2',
      [email, telefono]
    );
    return result.rows.length > 0;
  }

  // ➕ Crear usuario
  static async create(data) {
    const { nombre, email, telefono, password, rol_id = 3, foto } = data;

    const result = await query(
      `INSERT INTO usuarios (nombre, email, telefono, password, rol_id, foto) 
       VALUES ($1, $2, $3, $4, $5, $6) 
       RETURNING id, nombre, email, telefono, rol_id, foto, activo, created_at`,
      [nombre, email, telefono, password, rol_id, foto]
    );

    return result.rows[0];
  }

  // ✏️ Actualizar usuario
  static async update(id, data) {
    const { nombre, email, telefono, rol_id, foto, activo, password } = data;

    if (Number(rol_id) === 2) {
      return await Usuario._promoverABarbero(id);
    }

    const updates = [];
    const params = [];
    let paramCount = 1;

    if (nombre !== undefined) {
      updates.push(`nombre = $${paramCount++}`);
      params.push(nombre);
    }

    if (email !== undefined) {
      updates.push(`email = $${paramCount++}`);
      params.push(email);
    }

    if (telefono !== undefined) {
      updates.push(`telefono = $${paramCount++}`);
      params.push(telefono);
    }

    if (rol_id !== undefined) {
      updates.push(`rol_id = $${paramCount++}`);
      params.push(Number(rol_id));
    }

    if (foto !== undefined) {
      updates.push(`foto = $${paramCount++}`);
      params.push(foto);
    }

    if (activo !== undefined) {
      updates.push(`activo = $${paramCount++}`);
      params.push(activo);
    }

    if (password !== undefined) {
      updates.push(`password = $${paramCount++}`);
      params.push(password);
    }

    if (updates.length === 0) return null;

    params.push(id);

    const result = await query(
      `UPDATE usuarios 
       SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP
       WHERE id = $${paramCount}
       RETURNING id, nombre, email, telefono, rol_id, foto, activo`,
      params
    );

    return result.rows[0];
  }

  // 🔒 Desactivar
  static async deactivate(id) {
    const result = await query(
      'UPDATE usuarios SET activo = false WHERE id = $1 RETURNING *',
      [id]
    );
    return result.rows[0];
  }

  // 🔓 Activar
  static async activate(id) {
    const result = await query(
      'UPDATE usuarios SET activo = true WHERE id = $1 RETURNING *',
      [id]
    );
    return result.rows[0];
  }

  // ❌ Eliminar
  static async delete(id) {
    await query('DELETE FROM usuarios WHERE id = $1', [id]);
    return true;
  }

  // 📊 Stats usuario
  static async getStats(id) {
    const result = await query(
      `SELECT 
        COUNT(CASE WHEN estado = 'completada' THEN 1 END) as citas_completadas,
        COUNT(CASE WHEN estado = 'cancelada' THEN 1 END) as citas_canceladas,
        COUNT(CASE WHEN estado = 'no_asistio' THEN 1 END) as citas_no_asistio,
        COUNT(*) as total_citas
      FROM citas
      WHERE cliente_id = $1`,
      [id]
    );
    return result.rows[0];
  }

  // 📊 Stats generales
  static async getGeneralStats() {
    const result = await query(`
      SELECT 
        COUNT(*) FILTER (WHERE r.nombre = 'cliente') as total_clientes,
        COUNT(*) FILTER (WHERE r.nombre = 'barbero') as total_barberos,
        COUNT(*) FILTER (WHERE r.nombre = 'admin') as total_admins,
        COUNT(*) FILTER (WHERE u.activo = true) as usuarios_activos,
        COUNT(*) FILTER (WHERE u.activo = false) as usuarios_inactivos,
        COUNT(*) as total_usuarios
      FROM usuarios u
      LEFT JOIN roles r ON u.rol_id = r.id
    `);
    return result.rows[0];
  }


  static async _promoverABarbero(usuarioId) {
return await transaction(async (client) => {

      // 1. Verificar que el usuario existe y es cliente (rol_id = 3)
      const { rows: userRows } = await client.query(
        `SELECT u.id, u.activo, r.nombre AS rol
         FROM usuarios u
         JOIN roles r ON u.rol_id = r.id
         WHERE u.id = $1`,
        [usuarioId]
      );

      const usuario = userRows[0];

      if (!usuario) {
        throw new Error('Usuario no encontrado');
      }
      if (!usuario.activo) {
        throw new Error('No se puede promover un usuario inactivo');
      }
      if (usuario.rol === 'Barbero') {
        throw new Error('El usuario ya es barbero');
      }

      // 2. Verificar que no tenga ya perfil en tabla barberos
      const { rows: barberoExiste } = await client.query(
        `SELECT id FROM barberos WHERE usuario_id = $1`,
        [usuarioId]
      );

      if (barberoExiste.length > 0) {
        throw new Error('El usuario ya tiene perfil de barbero');
      }

      const { rows: updatedUser } = await client.query(
        `UPDATE usuarios
         SET rol_id = 2, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1
         RETURNING id, nombre, email, telefono, rol_id, foto, activo`,
        [usuarioId]
      );

      // 4. Crear perfil de barbero vacío (sin horarios aún)
      const { rows: barberoRows } = await client.query(
        `INSERT INTO barberos (usuario_id)
         VALUES ($1)
         RETURNING id AS barbero_id, usuario_id, especialidad, calificacion, activo`,
        [usuarioId]
      );


      return {
        ...updatedUser[0],
        barbero: barberoRows[0],
        promovido: true,
      };
    });
  }
}

export default Usuario;