import bcrypt from 'bcrypt';
import Usuario from '../models/Usuario.model.js';
import { query } from '../config/database.js';
import emailService from '../utils/emailService.js';

class UsuarioController {
  
  static async getAll(req, res) {
    try {

      console.log("Consultando usuarios")
      
      const { rol, activo, search, page, limit } = req.query;
      
      
      const usuarios = await Usuario.findAll({ 
        rol, 
        activo, 
        search, 
        page, 
        limit 
      });

      const total = await Usuario.count({ rol, activo, search });

      res.json({
        usuarios,
        pagination: {
          total,
          page: parseInt(page) || 1,
          limit: parseInt(limit) || 10,
          totalPages: Math.ceil(total / (parseInt(limit) || 10))
        }
      });
    } catch (error) {

      console.log(error)
      console.error('Error:', error);
      res.status(500).json({ error: 'Error al obtener usuarios' });
    }
  }

  // GET /api/admin/usuarios/:id
  static async getById(req, res) {
    try {
      const { id } = req.params;

      const usuario = await Usuario.findById(id);

      if (!usuario) {
        return res.status(404).json({ error: 'Usuario no encontrado' });
      }

      const estadisticas = await Usuario.getStats(id);

      res.json({
        usuario,
        estadisticas
      });
    } catch (error) {
      console.error('Error:', error);
      res.status(500).json({ error: 'Error al obtener usuario' });
    }
  }

  // POST /api/admin/usuarios
  static async create(req, res) {
    try {
      const { nombre, email, telefono, password, rol, foto } = req.body;

      // Verificar si ya existe
      const exists = await Usuario.existsEmailOrPhone(email, telefono);
      if (exists) {
        return res.status(400).json({ 
          error: 'El email o teléfono ya están registrados' 
        });
      }

      const hashedPassword = await bcrypt.hash(password, 10);

      const usuario = await Usuario.create({
        nombre,
        email,
        telefono,
        password: hashedPassword,
        rol,
        foto
      });

      res.status(201).json({
        message: 'Usuario creado exitosamente',
        usuario
      });
    } catch (error) {
      console.error('Error:', error);
      res.status(500).json({ error: 'Error al crear usuario' });
    }
  }

  // PUT /api/admin/usuarios/:id
  static async update(req, res) {
    try {
      const { id } = req.params;
      const { password, ...updateData } = req.body;

      if (password) {
        updateData.password = await bcrypt.hash(password, 10);
      }

      const usuario = await Usuario.update(id, updateData);

      if (!usuario) {
        return res.status(404).json({ error: 'Usuario no encontrado' });
      }

      if (password) {
        emailService.sendPasswordChangedEmail(usuario.email, usuario.nombre)
          .catch((err) => console.error('Error al enviar correo de cambio de contraseña:', err.message));
      }

      res.json({
        message: 'Usuario actualizado exitosamente',
        usuario
      });
    } catch (error) {
      console.error('Error:', error);
      res.status(500).json({ error: 'Error al actualizar usuario' });
    }
  }

  // DELETE /api/admin/usuarios/:id
  static async delete(req, res) {
    try {
      const { id } = req.params;
      const { permanente } = req.query;

      if (permanente === 'true') {
        await Usuario.delete(id);
        res.json({ message: 'Usuario eliminado permanentemente' });
      } else {
        const usuario = await Usuario.deactivate(id);
        
        if (!usuario) {
          return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        res.json({ message: 'Usuario desactivado exitosamente' });
      }
    } catch (error) {
      console.error('Error:', error);
      res.status(500).json({ error: 'Error al eliminar usuario' });
    }
  }

  // PUT /api/admin/usuarios/:id/activar
  static async activate(req, res) {
    try {
      const { id } = req.params;

      const usuario = await Usuario.activate(id);

      if (!usuario) {
        return res.status(404).json({ error: 'Usuario no encontrado' });
      }

      res.json({ 
        message: 'Usuario activado exitosamente',
        usuario
      });
    } catch (error) {
      console.error('Error:', error);
      res.status(500).json({ error: 'Error al activar usuario' });
    }
  }

  // POST /api/admin/usuarios/:id/convertir-barbero
  static async convertToBarbero(req, res) {
    try {
      const { id } = req.params;
      const { especialidad, años_experiencia, descripcion } = req.body;

      const user = await Usuario.findById(id);
      if (!user) {
        return res.status(404).json({ error: 'Usuario no encontrado' });
      }

      // Verificar si ya es barbero
      const barberoExiste = await query(
        'SELECT id FROM barberos WHERE usuario_id = $1',
        [id]
      );

      if (barberoExiste.rows.length > 0) {
        return res.status(400).json({ error: 'El usuario ya es barbero' });
      }

      // Actualizar rol
      await Usuario.update(id, { rol: 'barbero' });

      // Crear perfil de barbero
      const result = await query(
        `INSERT INTO barberos (usuario_id, especialidad, años_experiencia, descripcion)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [id, especialidad, años_experiencia, descripcion]
      );

      res.json({
        message: 'Usuario convertido a barbero exitosamente',
        barbero: result.rows[0]
      });
    } catch (error) {
      console.error('Error:', error);
      res.status(500).json({ error: 'Error al convertir usuario' });
    }
  }

  // GET /api/admin/usuarios/estadisticas/generales
  static async getGeneralStats(req, res) {
    try {
      const estadisticas = await Usuario.getGeneralStats();
      res.json({ estadisticas });
    } catch (error) {
      console.error('Error:', error);
      res.status(500).json({ error: 'Error al obtener estadísticas' });
    }
  }
}

export default UsuarioController;
