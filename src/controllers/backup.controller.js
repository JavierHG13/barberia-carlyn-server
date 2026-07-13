import { v2 as cloudinary } from 'cloudinary';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import bytes from 'bytes';
import { Backup, BackupConfig } from '../models/backup.model.js';
import { subirLog } from '../utils/backupLogger.js';

const execAsync = promisify(exec);

cloudinary.config({
  cloud_name : process.env.CLOUDINARY_CLOUD_NAME,
  api_key    : process.env.CLOUDINARY_API_KEY,
  api_secret : process.env.CLOUDINARY_API_SECRET,
});

class BackupController {
  constructor() {
    this.tempDir = path.join(process.cwd(), 'temp_backups');
    if (!fs.existsSync(this.tempDir)) fs.mkdirSync(this.tempDir, { recursive: true });
  }

  // ──────────────────────────────────────────────────────────────
  // GET /api/admin/backups
  // ──────────────────────────────────────────────────────────────
  static async getAll(req, res) {
    try {
      const { tipo, limit, offset } = req.query;
      const backups = await Backup.findAll({ tipo, limit, offset });
      const total   = await Backup.count({ tipo });
      res.json({
        backups,
        total,
        pagination: { limit: parseInt(limit) || 50, offset: parseInt(offset) || 0 },
      });
    } catch (error) {
      console.error('Error:', error);
      res.status(500).json({ error: 'Error al obtener backups' });
    }
  }

  static listAllTables = async (req, res) => {
    try {
      const tables = await Backup.getAllTables();
      res.json(tables);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Error al obtener tablas' });
    }
  };

  // ──────────────────────────────────────────────────────────────
  // GET /api/admin/backups/recientes
  // ──────────────────────────────────────────────────────────────
  static async getRecent(req, res) {
    try {
      const { limit = 10 } = req.query;
      const backups = await Backup.getRecent(parseInt(limit));
      res.json({ backups });
    } catch (error) {
      res.status(500).json({ error: 'Error al obtener backups recientes' });
    }
  }

  // ──────────────────────────────────────────────────────────────
  // GET /api/admin/backups/estadisticas
  // ──────────────────────────────────────────────────────────────
  static async getStats(req, res) {
    try {
      const stats = await Backup.getStats();
      res.json({
        estadisticas: {
          ...stats,
          tamaño_total_legible : BackupController.formatBytes(stats.tamaño_total_bytes || 0),
          promedio_tamaño      : stats.total_backups > 0
            ? BackupController.formatBytes((stats.tamaño_total_bytes || 0) / stats.total_backups)
            : '0 B',
        },
      });
    } catch (error) {
      res.status(500).json({ error: 'Error al obtener estadísticas' });
    }
  }

  // ──────────────────────────────────────────────────────────────
  // GET /api/admin/backups/:id
  // ──────────────────────────────────────────────────────────────
  static async getById(req, res) {
    try {
      const backup = await Backup.findById(req.params.id);
      if (!backup) return res.status(404).json({ error: 'Backup no encontrado' });
      res.json({ backup });
    } catch (error) {
      res.status(500).json({ error: 'Error al obtener backup' });
    }
  }

  // ──────────────────────────────────────────────────────────────
  // POST /api/admin/backups/manual
  // ──────────────────────────────────────────────────────────────
  static async createManual(req, res) {
    const tempDir = path.join(process.cwd(), 'temp_backups');
    const start   = Date.now();

    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName  = `backup_sql_${timestamp}.sql`;
    const localPath = path.join(tempDir, fileName);
    const logLines  = [`[${new Date().toISOString()}] Backup manual iniciado`];

    try {
      const { descripcion, incluir_tablas, excluir_tablas } = req.body;
      const usuario_id = req.user.id;

      // ── 1. pg_dump ────────────────────────────────────────────
      let command = `pg_dump`;
      command += ` -h ${process.env.DB_HOST}`;
      command += ` -p ${process.env.DB_PORT}`;
      command += ` -U ${process.env.DB_USER}`;
      command += ` -d ${process.env.DB_NAME}`;
      command += ` --no-owner --no-acl`;

      if (incluir_tablas?.length) {
        incluir_tablas.forEach(t => { command += ` -t ${t}`; });
        logLines.push(`[INFO] Tablas incluidas: ${incluir_tablas.join(', ')}`);
      }
      if (excluir_tablas?.length) {
        excluir_tablas.forEach(t => { command += ` -T ${t}`; });
        logLines.push(`[INFO] Tablas excluidas: ${excluir_tablas.join(', ')}`);
      }

      command += ` > "${localPath}"`;
      logLines.push(`[INFO] Ejecutando pg_dump...`);

      await execAsync(command, { env: { ...process.env, PGPASSWORD: process.env.DB_PASSWORD } });

      if (!fs.existsSync(localPath)) throw new Error('El archivo de backup no se generó');

      const stats         = fs.statSync(localPath);
      const tamaño_bytes  = stats.size;
      const tamaño_legible = bytes(tamaño_bytes);
      logLines.push(`[INFO] Archivo generado: ${fileName} (${tamaño_legible})`);

      // ── 2. Subir .sql a Cloudinary ────────────────────────────
      const cloudinaryFolder = process.env.BACKUP_CLOUDINARY_FOLDER || 'barberia-backups';
      logLines.push(`[INFO] Subiendo a Cloudinary...`);

      const uploadResult = await cloudinary.uploader.upload(localPath, {
        resource_type : 'raw',
        folder        : cloudinaryFolder,
        public_id     : `sql_${timestamp}`,
        use_filename  : true,
      });
      logLines.push(`[INFO] Subido a Cloudinary: ${uploadResult.secure_url}`);

      // ── 3. Subir .log a Cloudinary ────────────────────────────
      const duracion_ms = Date.now() - start;
      logLines.push(`[INFO] Base de datos : ${process.env.DB_NAME}`);
      logLines.push(`[INFO] Host          : ${process.env.DB_HOST}`);
      logLines.push(`[INFO] Duración      : ${duracion_ms}ms`);
      logLines.push(`[${new Date().toISOString()}] Backup completado exitosamente`);

      const { url: log_url, public_id: log_cloud_key } = await subirLog({
        fileName : fileName.replace('.sql', ''),
        tipo     : 'backup_manual',
        estado   : 'completado',
        lineas   : logLines,
        folder   : cloudinaryFolder,
      });

      // ── 4. Registrar en BD ────────────────────────────────────
      const retencion_dias = parseInt(process.env.BACKUP_RETENTION_DAYS) || 30;
      const expires_at = new Date();
      expires_at.setDate(expires_at.getDate() + retencion_dias);

      const backup = await Backup.create({
        nombre_archivo : fileName,
        tipo           : 'Manual',
        tamaño_bytes,
        tamaño_legible,
        url_descarga   : uploadResult.secure_url,
        cloud_key      : uploadResult.public_id,
        cloud_provider : 'cloudinary',
        descripcion,
        usuario_id,
        configuracion_id : null,
        metadata : {
          database                  : process.env.DB_NAME,
          tablas_incluidas          : incluir_tablas,
          tablas_excluidas          : excluir_tablas,
          cloudinary_public_id      : uploadResult.public_id,
          cloudinary_resource_type  : uploadResult.resource_type,
          cloudinary_format         : uploadResult.format,
        },
        expires_at,
        log_url,
        log_cloud_key,
      });

      fs.unlinkSync(localPath);
      console.log('✅ Backup SQL completado');

      res.status(201).json({ message: 'Backup creado exitosamente', backup });

    } catch (error) {
      console.error('Error al crear backup:', error);
      const duracion_ms = Date.now() - start;

      logLines.push(`[ERROR] ${error.message}`);
      logLines.push(`[${new Date().toISOString()}] Backup fallido tras ${duracion_ms}ms`);

      // Intentar subir log de error
      await subirLog({
        fileName : fileName.replace('.sql', ''),
        tipo     : 'backup_manual',
        estado   : 'fallido',
        lineas   : logLines,
        folder   : process.env.BACKUP_CLOUDINARY_FOLDER,
      }).catch(() => {});

      // Limpiar temporal
      try {
        if (fs.existsSync(localPath)) fs.unlinkSync(localPath);
      } catch (_) {}

      res.status(500).json({ error: 'Error al crear backup', details: error.message });
    }
  }

  // ──────────────────────────────────────────────────────────────
  // DELETE /api/admin/backups/:id
  // ──────────────────────────────────────────────────────────────
  static async delete(req, res) {
    try {
      const backup = await Backup.findById(req.params.id);
      if (!backup) return res.status(404).json({ error: 'Backup no encontrado' });

      // Eliminar .sql de Cloudinary
      await cloudinary.uploader.destroy(backup.cloud_key, { resource_type: 'raw' })
        .catch(e => console.warn('⚠ Error al eliminar .sql de Cloudinary:', e.message));

      // Eliminar .log de Cloudinary si existe
      if (backup.log_cloud_key) {
        await cloudinary.uploader.destroy(backup.log_cloud_key, { resource_type: 'raw' })
          .catch(e => console.warn('⚠ Error al eliminar .log de Cloudinary:', e.message));
      }

      await Backup.delete(req.params.id);
      res.json({ message: 'Backup eliminado exitosamente' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  // ──────────────────────────────────────────────────────────────
  // POST /api/admin/backups/limpiar-expirados
  // ──────────────────────────────────────────────────────────────
  static async cleanExpired(req, res) {
    try {
      const expired = await Backup.deleteExpired();

      for (const backup of expired) {
        await cloudinary.uploader.destroy(backup.cloud_key, { resource_type: 'raw' })
          .catch(() => {});

        if (backup.log_cloud_key) {
          await cloudinary.uploader.destroy(backup.log_cloud_key, { resource_type: 'raw' })
            .catch(() => {});
        }
      }

      res.json({
        message          : 'Backups expirados eliminados',
        total_eliminados : expired.length,
        backups          : expired.map(b => b.nombre_archivo),
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  // ──────────────────────────────────────────────────────────────
  // GET /api/admin/backups/cloudinary/verificar
  // ──────────────────────────────────────────────────────────────
  static async verifyCloudinary(req, res) {
    try {
      const result = await cloudinary.api.ping();
      res.json({
        conectado  : result.status === 'ok',
        cloud_name : process.env.CLOUDINARY_CLOUD_NAME,
        status     : result.status,
      });
    } catch (error) {
      res.status(500).json({ conectado: false, error: 'Error al verificar conexión con Cloudinary' });
    }
  }

  // ──────────────────────────────────────────────────────────────
  // Configuración de backups automáticos
  // ──────────────────────────────────────────────────────────────
  static async getConfigs(req, res) {
    try {
      const configs = await BackupConfig.findAll();
      res.json({ configuraciones: configs });
    } catch (error) {
      res.status(500).json({ error: 'Error al obtener configuraciones' });
    }
  }

  static async getConfigById(req, res) {
    try {
      const config = await BackupConfig.findById(req.params.id);
      if (!config) return res.status(404).json({ error: 'Configuración no encontrada' });
      res.json({ configuracion: config });
    } catch (error) {
      res.status(500).json({ error: 'Error al obtener configuración' });
    }
  }

  static async createConfig(req, res) {
    try {
      console.log(req.body)
      const config = await BackupConfig.create(req.body);
      res.status(201).json({ message: 'Configuración creada exitosamente', configuracion: config });
    } catch (error) {
      console.log(error)
      res.status(500).json({ error: error.message });
    }
  }

  static async updateConfig(req, res) {
    try {
      const config = await BackupConfig.update(req.params.id, req.body);
      if (!config) return res.status(404).json({ error: 'Configuración no encontrada' });
      res.json({ message: 'Configuración actualizada exitosamente', configuracion: config });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  static async toggleConfig(req, res) {
    try {
      const { activo } = req.body;
      const config = await BackupConfig.toggleActive(req.params.id, activo);
      if (!config) return res.status(404).json({ error: 'Configuración no encontrada' });
      res.json({
        message      : activo ? 'Configuración activada' : 'Configuración desactivada',
        configuracion: config,
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  static async deleteConfig(req, res) {
    try {
      const config = await BackupConfig.delete(req.params.id);
      if (!config) return res.status(404).json({ error: 'Configuración no encontrada' });
      res.json({ message: 'Configuración eliminada exitosamente' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  static formatBytes(b) {
    if (!b || b === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(b) / Math.log(k));
    return Math.round((b / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  }
}

export default BackupController;