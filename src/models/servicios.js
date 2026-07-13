import { query } from '../config/database.js';

class Servicio {

  static async findAll(filters = {}) {
    const { activo, search } = filters;
    
    let queryText = 'SELECT * FROM tbl_servicios WHERE 1=1';
    const params = [];
    let paramCount = 1;

    if (activo !== undefined) {
      queryText += ` AND activo = $${paramCount}`;
      params.push(activo === 'true');
      paramCount++;
    }

    if (search) {
      queryText += ` AND (nombre ILIKE $${paramCount} OR descripcion ILIKE $${paramCount})`;
      params.push(`%${search}%`);
      paramCount++;
    }

    queryText += ' ORDER BY nombre ASC';

    const result = await query(queryText, params);
    return result.rows;
  }

  /**
   * Obtener servicio por ID
   */
  static async findById(id) {
    const result = await query(
      'SELECT * FROM tbl_servicios WHERE id = $1',
      [id]
    );
    return result.rows[0] || null;
  }

  /**
   * Verificar si existe un servicio con el mismo nombre
   */
  static async existsByName(nombre, excludeId = null) {
    let queryText = 'SELECT id FROM tbl_servicios WHERE nombre ILIKE $1';
    const params = [nombre];

    if (excludeId) {
      queryText += ' AND id != $2';
      params.push(excludeId);
    }

    const result = await query(queryText, params);
    return result.rows.length > 0;
  }

  /**
   * Crear nuevo servicio con imagen
   */
  static async create(data) {
    const { nombre, descripcion, duracion, precio, imagen_url, imagen_public_id } = data;

    const result = await query(
      `INSERT INTO tbl_servicios (nombre, descripcion, duracion, precio, imagen_url, imagen_public_id) 
       VALUES ($1, $2, $3, $4, $5, $6) 
       RETURNING *`,
      [nombre, descripcion, duracion, precio, imagen_url, imagen_public_id]
    );

    return result.rows[0];
  }

  /**
   * Actualizar servicio existente con imagen
   */
  static async update(id, data) {
    const { nombre, descripcion, duracion, precio, activo, imagen_url, imagen_public_id } = data;

    const updates = [];
    const params = [];
    let paramCount = 1;

    if (nombre !== undefined) {
      updates.push(`nombre = $${paramCount}`);
      params.push(nombre);
      paramCount++;
    }

    if (descripcion !== undefined) {
      updates.push(`descripcion = $${paramCount}`);
      params.push(descripcion);
      paramCount++;
    }

    if (duracion !== undefined) {
      updates.push(`duracion = $${paramCount}`);
      params.push(duracion);
      paramCount++;
    }

    if (precio !== undefined) {
      updates.push(`precio = $${paramCount}`);
      params.push(precio);
      paramCount++;
    }

    if (activo !== undefined) {
      updates.push(`activo = $${paramCount}`);
      params.push(activo);
      paramCount++;
    }

    if (imagen_url !== undefined) {
      updates.push(`imagen_url = $${paramCount}`);
      params.push(imagen_url);
      paramCount++;
    }

    if (imagen_public_id !== undefined) {
      updates.push(`imagen_public_id = $${paramCount}`);
      params.push(imagen_public_id);
      paramCount++;
    }

    if (updates.length === 0) {
      return null;
    }

    updates.push(`updated_at = CURRENT_TIMESTAMP`);

    params.push(id);
    const result = await query(
      `UPDATE tbl_servicios 
       SET ${updates.join(', ')} 
       WHERE id = $${paramCount} 
       RETURNING *`,
      params
    );

    return result.rows[0] || null;
  }

  /**
   * Desactivar servicio (soft delete)
   */
  static async deactivate(id) {
    const result = await query(
      `UPDATE tbl_servicios 
       SET activo = false, updated_at = CURRENT_TIMESTAMP 
       WHERE id = $1 
       RETURNING *`,
      [id]
    );
    return result.rows[0] || null;
  }

  /**
   * Activar servicio
   */
  static async activate(id) {
    const result = await query(
      `UPDATE tbl_servicios 
       SET activo = true, updated_at = CURRENT_TIMESTAMP 
       WHERE id = $1 
       RETURNING *`,
      [id]
    );
    return result.rows[0] || null;
  }

  /**
   * Eliminar servicio permanentemente
   */
  static async delete(id) {
    const result = await query(
      'DELETE FROM tbl_servicios WHERE id = $1 RETURNING id',
      [id]
    );
    return result.rows.length > 0;
  }

  /**
   * Contar servicios con filtros
   */
  static async count(filters = {}) {
    const { activo } = filters;
    
    let queryText = 'SELECT COUNT(*) as total FROM tbl_servicios WHERE 1=1';
    const params = [];
    let paramCount = 1;

    if (activo !== undefined) {
      queryText += ` AND activo = $${paramCount}`;
      params.push(activo === 'true');
    }

    const result = await query(queryText, params);
    return parseInt(result.rows[0].total);
  }

  /**
   * Obtener servicios más populares
   */
  static async getMostPopular(limit = 5) {
    const result = await query(
      `SELECT 
        s.*,
        COUNT(c.id) as total_citas
      FROM tbl_servicios s
      LEFT JOIN citas c ON s.id = c.servicio_id
      WHERE s.activo = true
      GROUP BY s.id
      ORDER BY total_citas DESC, s.nombre ASC
      LIMIT $1`,
      [limit]
    );
    return result.rows;
  }

  /**
   * Obtener estadísticas de un servicio
   */
  static async getStats(id) {
    const result = await query(
      `SELECT 
        COUNT(c.id) as total_citas,
        COUNT(CASE WHEN c.estado = 'completada' THEN 1 END) as citas_completadas,
        SUM(CASE WHEN c.estado = 'completada' THEN c.monto_pagado ELSE 0 END) as ingresos_totales
      FROM citas c
      WHERE c.servicio_id = $1`,
      [id]
    );
    return result.rows[0] || {
      total_citas: 0,
      citas_completadas: 0,
      ingresos_totales: 0
    };
  }
}

export default Servicio;