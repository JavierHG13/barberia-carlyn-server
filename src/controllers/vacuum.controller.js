import { exec } from 'child_process';
import { promisify } from 'util';
import { v2 as cloudinary } from 'cloudinary';
import { Vacuum, VacuumConfig } from '../models/backup.model.js';
import { subirLog } from '../utils/backupLogger.js';

const execAsync = promisify(exec);

// ─────────────────────────────────────────────────────────────
// Lógica central reutilizada por manual y scheduler
// ─────────────────────────────────────────────────────────────
export async function ejecutarVacuum({ config = {}, usuario_id = null, tipo = 'Manual' }) {

  console.log("Ejecutando vacuum")
  const start = Date.now();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `vacuum_${tipo.toLowerCase()}_${timestamp}`;

  const tablas = config.tablas ?? [];

  const opciones = 'ANALYZE';

  const logLines = [`[${new Date().toISOString()}] VACUUM iniciado`];
  logLines.push(`[INFO] Opciones : ${opciones}`);
  logLines.push(`[INFO] Tablas   : ${tablas.length ? tablas.join(', ') : '(toda la base de datos)'}`);

  const targets = tablas.length ? tablas : [null];
  const resultados = [];
  let estado = 'Completado';
  let errorMsg = null;

  for (const tabla of targets) {

    let sql = `VACUUM (${opciones})`;

    if (tabla) {
      sql += ` ${tabla}`;
    }

    console.log('SQL VACUUM:', sql);

    logLines.push(`\n[${new Date().toISOString()}] Ejecutando: ${sql}`);

    try {
      const psqlCmd = [
        'psql',
        `-h ${process.env.DB_HOST}`,
        `-p ${process.env.DB_PORT}`,
        `-U ${process.env.DB_USER}`,
        `-d ${process.env.DB_NAME}`,
        `-c "${sql}"`,
      ].join(' ');

      const { stdout, stderr } = await execAsync(psqlCmd, {
        env: { ...process.env, PGPASSWORD: process.env.DB_PASSWORD },
      });

      const output = stdout.trim() || stderr.trim();
      logLines.push(`[OK] ${tabla ?? '(toda la BD)'} → ${output}`);
      resultados.push({ tabla: tabla ?? '(toda la BD)', ok: true, output });

    } catch (err) {
      logLines.push(`[ERROR] ${tabla ?? '(toda la BD)'} → ${err.message}`);
      resultados.push({ tabla: tabla ?? '(toda la BD)', ok: false, error: err.message });
      estado = 'Fallido';
      errorMsg = err.message;

      console.log(err);
    }
  }

  const duracion_ms = Date.now() - start;
  logLines.push(`\n[${new Date().toISOString()}] VACUUM finalizado`);
  logLines.push(`[INFO] Duración : ${duracion_ms}ms`);
  logLines.push(`[INFO] Estado   : ${estado}`);

  const { url: log_url, public_id: log_cloud_key } = await subirLog({
    fileName,
    tipo: `vacuum_${tipo.toLowerCase()}`,
    estado: estado.toLowerCase(),
    lineas: logLines,
    folder: process.env.BACKUP_CLOUDINARY_FOLDER,
  });


  const vacuum = await Vacuum.create({
    configuracion_id: config.id ?? null,
    tipo,
    tablas,
    estado,
    duracion_ms,
    log_url,
    log_cloud_key,
    descripcion: config.descripcion ?? null,
    usuario_id,
    metadata: { opciones, resultados, database: process.env.DB_NAME },
  });

  return { vacuum, log_url, resultados, duracion_ms, estado, errorMsg };
}

// ─────────────────────────────────────────────────────────────
// Controlador HTTP
// ─────────────────────────────────────────────────────────────
class VacuumController {

  /** POST /api/admin/vacuums/manual */
  static async runManual(req, res) {
    try {
      const { tablas = [], descripcion } = req.body;

      console.log("Ejecutando vacuum nalyze")

      const result = await ejecutarVacuum({
        config: { tablas, descripcion },
        usuario_id: req.user.id,
        tipo: 'Manual',
      });

      res.status(201).json({
        message: `VACUUM ${result.estado.toLowerCase()}`,
        vacuum: result.vacuum,
        log_url: result.log_url,
        duracion_ms: result.duracion_ms,
        resultados: result.resultados,
      });
    } catch (error) {
      console.error('Error en VACUUM manual:', error);
      res.status(500).json({ error: error.message });
    }
  }

  /** GET /api/admin/vacuums */
  static async getAll(req, res) {
    try {
      const { limit, offset } = req.query;
      const vacuums = await Vacuum.findAll({ limit, offset });
      res.json({ vacuums });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  /** GET /api/admin/vacuums/:id */
  static async getById(req, res) {
    try {
      const vacuum = await Vacuum.findById(req.params.id);
      if (!vacuum) return res.status(404).json({ error: 'No encontrado' });
      res.json({ vacuum });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  /** DELETE /api/admin/vacuums/:id */
  static async delete(req, res) {
    try {
      const vacuum = await Vacuum.findById(req.params.id);
      if (!vacuum) return res.status(404).json({ error: 'No encontrado' });

      if (vacuum.log_cloud_key) {
        await cloudinary.uploader.destroy(vacuum.log_cloud_key, { resource_type: 'raw' })
          .catch(() => { });
      }

      await Vacuum.delete(req.params.id);
      res.json({ message: 'VACUUM eliminado exitosamente' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  // ── Configuraciones ────────────────────────────────────────────

  /** GET /api/admin/vacuums/configuracion */
  static async getConfigs(req, res) {
    try {
      res.json({ configuraciones: await VacuumConfig.findAll() });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  /** POST /api/admin/vacuums/configuracion */
  static async createConfig(req, res) {
    console.log("creando configuracion")
    
    try {
      const config = await VacuumConfig.createConfig(req.body);

      console.log(config)

      console.log(req.body)
      res.status(201).json({ message: 'Configuración creada', configuracion: config });
    } catch (error) {
      console.log(error)
      res.status(500).json({ error: error.message });
    }
  }

  /** PUT /api/admin/vacuums/configuracion/:id */
  static async updateConfig(req, res) {
    try {
      const config = await VacuumConfig.update(req.params.id, req.body);
      if (!config) return res.status(404).json({ error: 'No encontrada' });
      res.json({ message: 'Configuración actualizada', configuracion: config });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  /** PUT /api/admin/vacuums/configuracion/:id/toggle */
  static async toggleConfig(req, res) {
    try {
      const config = await VacuumConfig.toggleActive(req.params.id, req.body.activo);
      if (!config) return res.status(404).json({ error: 'No encontrada' });
      res.json({ message: req.body.activo ? 'Activada' : 'Desactivada', configuracion: config });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  /** DELETE /api/admin/vacuums/configuracion/:id */
  static async deleteConfig(req, res) {
    try {
      const config = await VacuumConfig.delete(req.params.id);
      if (!config) return res.status(404).json({ error: 'No encontrada' });
      res.json({ message: 'Configuración eliminada' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
}

export default VacuumController;