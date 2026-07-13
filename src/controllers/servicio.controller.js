import { v2 as cloudinary } from 'cloudinary';
import Servicio from "../models/servicios.js";
import fs from 'fs';
import path from 'path';

// Configurar Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

class ServicioController {
  /**
   * GET /api/servicios
   * Obtener todos los servicios
   */
  static async getAll(req, res) {
    try {
      const { activo, search } = req.query;
      const servicios = await Servicio.findAll({ activo, search });
      res.json({ servicios, total: servicios.length });
    } catch (error) {
      console.error('Error al obtener servicios:', error);
      res.status(500).json({ error: 'Error al obtener servicios' });
    }
  }

  /**
   * GET /api/servicios/activos
   * Obtener solo servicios activos
   */
  static async getActive(req, res) {
    try {
      const servicios = await Servicio.findAll({ activo: 'true' });
      res.json({ servicios, total: servicios.length });
    } catch (error) {
      console.error('Error:', error);
      res.status(500).json({ error: 'Error al obtener servicios activos' });
    }
  }

  /**
   * GET /api/servicios/populares
   * Obtener servicios más populares
   */
  static async getMostPopular(req, res) {
    try {
      const { limit = 5 } = req.query;
      const servicios = await Servicio.getMostPopular(parseInt(limit));
      res.json({ servicios, total: servicios.length });
    } catch (error) {
      console.error('Error:', error);
      res.status(500).json({ error: 'Error al obtener servicios populares' });
    }
  }

  /**
   * GET /api/servicios/:id
   * Obtener servicio por ID
   */
  static async getById(req, res) {
    try {
      const { id } = req.params;
      const servicio = await Servicio.findById(id);

      if (!servicio) {
        return res.status(404).json({ error: 'Servicio no encontrado' });
      }

      res.json({ servicio });
    } catch (error) {
      console.error('Error:', error);
      res.status(500).json({ error: 'Error al obtener servicio' });
    }
  }

  /**
   * GET /api/servicios/:id/estadisticas
   * Obtener estadísticas de un servicio
   */
  static async getStats(req, res) {
    try {
      const { id } = req.params;
      const servicio = await Servicio.findById(id);
      
      if (!servicio) {
        return res.status(404).json({ error: 'Servicio no encontrado' });
      }

      const estadisticas = await Servicio.getStats(id);
      res.json({ servicio, estadisticas });
    } catch (error) {
      console.error('Error:', error);
      res.status(500).json({ error: 'Error al obtener estadísticas' });
    }
  }

  /**
   * Subir imagen a Cloudinary
   */
  static async uploadImage(file) {
    try {
      const result = await cloudinary.uploader.upload(file, {
        folder: 'barberia-servicios',
        transformation: [
          { width: 500, height: 500, crop: 'limit' },
          { quality: 'auto' }
        ]
      });
      return {
        url: result.secure_url,
        public_id: result.public_id
      };
    } catch (error) {
      console.error('Error al subir imagen:', error);
      throw error;
    }
  }

  /**
   * Eliminar imagen de Cloudinary
   */
  static async deleteImage(publicId) {
    if (!publicId) return;
    try {
      await cloudinary.uploader.destroy(publicId);
      console.log(`Imagen eliminada: ${publicId}`);
    } catch (error) {
      console.error('Error al eliminar imagen:', error);
    }
  }

  /**
   * POST /api/servicios
   * Crear nuevo servicio con imagen
   */
  static async create(req, res) {
    let tempFilePath = null;
    
    try {
      const { nombre, descripcion, duracion, precio } = req.body;
      const imagen = req.file;

      // Verificar si ya existe un servicio con ese nombre
      const exists = await Servicio.existsByName(nombre);
      if (exists) {
        return res.status(400).json({ error: 'Ya existe un servicio con ese nombre' });
      }

      // Validar duracion y precio
      if (duracion <= 0) {
        return res.status(400).json({ error: 'La duración debe ser mayor a 0 minutos' });
      }

      if (precio <= 0) {
        return res.status(400).json({ error: 'El precio debe ser mayor a 0' });
      }

      let imagen_url = null;
      let imagen_public_id = null;

      // Subir imagen a Cloudinary si existe
      if (imagen) {
        const uploadResult = await ServicioController.uploadImage(imagen.path);
        imagen_url = uploadResult.url;
        imagen_public_id = uploadResult.public_id;
        tempFilePath = imagen.path;
      }

      const servicio = await Servicio.create({
        nombre,
        descripcion,
        duracion: parseInt(duracion),
        precio: parseFloat(precio),
        imagen_url,
        imagen_public_id
      });

      // Limpiar archivo temporal
      if (tempFilePath && fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }

      res.status(201).json({
        message: 'Servicio creado exitosamente',
        servicio
      });
    } catch (error) {
      // Limpiar archivo temporal en caso de error
      if (tempFilePath && fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }
      console.error('Error al crear servicio:', error);
      res.status(500).json({ error: 'Error al crear servicio' });
    }
  }

  /**
   * PUT /api/servicios/:id
   * Actualizar servicio con imagen
   */
  static async update(req, res) {
    let tempFilePath = null;
    
    try {
      const { id } = req.params;
      const { nombre, descripcion, duracion, precio, activo } = req.body;
      const imagen = req.file;

      // Verificar que el servicio existe
      const servicioActual = await Servicio.findById(id);
      if (!servicioActual) {
        return res.status(404).json({ error: 'Servicio no encontrado' });
      }

      // Si se está cambiando el nombre, verificar que no exista otro con ese nombre
      if (nombre && nombre !== servicioActual.nombre) {
        const exists = await Servicio.existsByName(nombre, id);
        if (exists) {
          return res.status(400).json({ error: 'Ya existe un servicio con ese nombre' });
        }
      }

      // Validar duracion si se proporciona
      if (duracion !== undefined && duracion <= 0) {
        return res.status(400).json({ error: 'La duración debe ser mayor a 0 minutos' });
      }

      // Validar precio si se proporciona
      if (precio !== undefined && precio <= 0) {
        return res.status(400).json({ error: 'El precio debe ser mayor a 0' });
      }

      let imagen_url = servicioActual.imagen_url;
      let imagen_public_id = servicioActual.imagen_public_id;

      // Subir nueva imagen a Cloudinary si existe
      if (imagen) {
        // Eliminar imagen anterior si existe
        if (imagen_public_id) {
          await ServicioController.deleteImage(imagen_public_id);
        }
        
        const uploadResult = await ServicioController.uploadImage(imagen.path);
        imagen_url = uploadResult.url;
        imagen_public_id = uploadResult.public_id;
        tempFilePath = imagen.path;
      }

      const servicio = await Servicio.update(id, {
        nombre,
        descripcion,
        duracion: duracion ? parseInt(duracion) : undefined,
        precio: precio ? parseFloat(precio) : undefined,
        activo: activo !== undefined ? activo === 'true' : undefined,
        imagen_url,
        imagen_public_id
      });

      // Limpiar archivo temporal
      if (tempFilePath && fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }

      if (!servicio) {
        return res.status(400).json({ error: 'No hay campos para actualizar' });
      }

      res.json({
        message: 'Servicio actualizado exitosamente',
        servicio
      });
    } catch (error) {
      // Limpiar archivo temporal en caso de error
      if (tempFilePath && fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }
      console.error('Error al actualizar servicio:', error);
      res.status(500).json({ error: 'Error al actualizar servicio' });
    }
  }

  /**
   * DELETE /api/servicios/:id
   * Desactivar servicio (soft delete) o eliminar permanentemente
   */
  static async deactivate(req, res) {
    try {
      const { id } = req.params;
      const { permanente } = req.query;

      const servicio = await Servicio.findById(id);
      if (!servicio) {
        return res.status(404).json({ error: 'Servicio no encontrado' });
      }

      if (permanente === 'true') {
        // Eliminar imagen de Cloudinary si existe
        if (servicio.imagen_public_id) {
          await ServicioController.deleteImage(servicio.imagen_public_id);
        }
        
        // Eliminar permanentemente
        const deleted = await Servicio.delete(id);
        
        if (!deleted) {
          return res.status(500).json({ error: 'No se pudo eliminar el servicio' });
        }

        res.json({ message: 'Servicio eliminado permanentemente' });
      } else {
        // Desactivar (soft delete)
        const servicioDesactivado = await Servicio.deactivate(id);

        res.json({ 
          message: 'Servicio desactivado exitosamente',
          servicio: servicioDesactivado
        });
      }
    } catch (error) {
      console.error('Error:', error);
      
      if (error.code === '23503') {
        return res.status(400).json({ 
          error: 'No se puede eliminar el servicio porque tiene citas asociadas. Desactívalo en su lugar.' 
        });
      }

      res.status(500).json({ error: 'Error al eliminar servicio' });
    }
  }

  /**
   * PUT /api/servicios/:id/activar
   * Activar servicio desactivado
   */
  static async activate(req, res) {
    try {
      const { id } = req.params;

      const servicio = await Servicio.findById(id);
      if (!servicio) {
        return res.status(404).json({ error: 'Servicio no encontrado' });
      }

      if (servicio.activo) {
        return res.status(400).json({ error: 'El servicio ya está activo' });
      }

      const servicioActivado = await Servicio.activate(id);

      res.json({ 
        message: 'Servicio activado exitosamente',
        servicio: servicioActivado
      });
    } catch (error) {
      console.error('Error:', error);
      res.status(500).json({ error: 'Error al activar servicio' });
    }
  }

  /**
   * GET /api/servicios/estadisticas/generales
   * Obtener estadísticas generales de servicios
   */
  static async getGeneralStats(req, res) {
    try {
      const totalActivos = await Servicio.count({ activo: 'true' });
      const totalInactivos = await Servicio.count({ activo: 'false' });
      const total = totalActivos + totalInactivos;
      const populares = await Servicio.getMostPopular(3);

      res.json({
        estadisticas: {
          total,
          activos: totalActivos,
          inactivos: totalInactivos,
          mas_populares: populares
        }
      });
    } catch (error) {
      console.error('Error:', error);
      res.status(500).json({ error: 'Error al obtener estadísticas' });
    }
  }
}

export default ServicioController;