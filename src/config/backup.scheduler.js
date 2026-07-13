import cron from 'node-cron';
import { v2 as cloudinary } from 'cloudinary';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import bytes from 'bytes';
import { Backup, BackupConfig, VacuumConfig } from '../models/backup.model.js';
import { ejecutarVacuum } from '../controllers/vacuum.controller.js';
import { subirLog } from '../utils/backupLogger.js';
import emailService from '../utils/emailService.js';

const execAsync = promisify(exec);

cloudinary.config({
  cloud_name : process.env.CLOUDINARY_CLOUD_NAME,
  api_key    : process.env.CLOUDINARY_API_KEY,
  api_secret : process.env.CLOUDINARY_API_SECRET,
});

// ─────────────────────────────────────────────────────────────
// Helpers compartidos
// ─────────────────────────────────────────────────────────────
function shouldRun(proximo, activo) {
  if (!activo) return false;
  if (!proximo) return true;
  const diffMs = Date.now() - new Date(proximo);
  return diffMs >= 0 && diffMs < 10 * 60 * 1000;
}

function calcularProximo(config, campoHora = 'hora_ejecucion') {
  const now = new Date();
  const [hh, mm] = (config[campoHora] || '02:00').split(':').map(Number);
  const next = new Date(now);

  switch (config.frecuencia) {
    case 'Diario':
      next.setDate(next.getDate() + 1);
      next.setHours(hh, mm, 0, 0);
      break;
    case 'Semanal': {
      const target   = config.dia_semana ?? 0;
      const daysUntil = (target - now.getDay() + 7) % 7 || 7;
      next.setDate(next.getDate() + daysUntil);
      next.setHours(hh, mm, 0, 0);
      break;
    }
    case 'Mensual':
      next.setMonth(next.getMonth() + 1);
      next.setDate(config.dia_mes ?? 1);
      next.setHours(hh, mm, 0, 0);
      break;
    default:
      next.setDate(next.getDate() + 1);
      next.setHours(hh, mm, 0, 0);
  }
  return next;
}

// ─────────────────────────────────────────────────────────────
// Backup automático
// ─────────────────────────────────────────────────────────────
async function runBackupForConfig(config) {
  const tempDir   = path.join(process.cwd(), 'temp_backups');
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName  = `backup_auto_${config.id}_${timestamp}.sql`;
  const localPath = path.join(tempDir, fileName);
  const start     = Date.now();
  const logLines  = [`[${new Date().toISOString()}] Backup automático iniciado — config: ${config.nombre} (id=${config.id})`];

  console.log(`\n🔄 [Scheduler] Ejecutando backup automático: "${config.nombre}" (id=${config.id})`);

  try {
    // ── 1. pg_dump ──────────────────────────────────────────────
    let command = `pg_dump`;
    command += ` -h ${process.env.DB_HOST}`;
    command += ` -p ${process.env.DB_PORT}`;
    command += ` -U ${process.env.DB_USER}`;
    command += ` -d ${process.env.DB_NAME}`;
    command += ` --no-owner --no-acl`;

    if (config.excluir_tablas?.length) {
      config.excluir_tablas.forEach(t => { command += ` -T ${t}`; });
      logLines.push(`[INFO] Tablas excluidas: ${config.excluir_tablas.join(', ')}`);
    }

    command += ` > "${localPath}"`;
    logLines.push(`[INFO] Ejecutando pg_dump...`);

    await execAsync(command, { env: { ...process.env, PGPASSWORD: process.env.DB_PASSWORD } });

    if (!fs.existsSync(localPath)) throw new Error('pg_dump no generó archivo');

    // ── 2. Subir .sql a Cloudinary ──────────────────────────────
    const stats         = fs.statSync(localPath);
    const tamaño_bytes  = stats.size;
    const tamaño_legible = bytes(tamaño_bytes);
    logLines.push(`[INFO] Archivo generado: ${fileName} (${tamaño_legible})`);

    const cloudFolder = config.cloud_folder
      || process.env.BACKUP_CLOUDINARY_FOLDER
      || 'barberia-backups';

    const uploadResult = await cloudinary.uploader.upload(localPath, {
      resource_type : 'raw',
      folder        : cloudFolder,
      public_id     : `auto_${config.id}_${timestamp}`,
    });
    logLines.push(`[INFO] Subido a Cloudinary: ${uploadResult.secure_url}`);

    // ── 3. Subir .log a Cloudinary ──────────────────────────────
    const duracion_ms = Date.now() - start;
    logLines.push(`[INFO] Base de datos : ${process.env.DB_NAME}`);
    logLines.push(`[INFO] Duración      : ${duracion_ms}ms`);
    logLines.push(`[${new Date().toISOString()}] Backup completado exitosamente`);

    const { url: log_url, public_id: log_cloud_key } = await subirLog({
      fileName : fileName.replace('.sql', ''),
      tipo     : 'backup_automatico',
      estado   : 'completado',
      lineas   : logLines,
      folder   : cloudFolder,
    });

    // ── 4. Calcular expiración y registrar en BD ────────────────
    const retencion_dias = config.retencion_dias
      || parseInt(process.env.BACKUP_RETENTION_DAYS) || 30;
    const expires_at = new Date();
    expires_at.setDate(expires_at.getDate() + retencion_dias);

    const backup = await Backup.create({
      nombre_archivo   : fileName,
      tipo             : 'Automatico',
      tamaño_bytes,
      tamaño_legible,
      url_descarga     : uploadResult.secure_url,
      cloud_key        : uploadResult.public_id,
      cloud_provider   : 'cloudinary',
      descripcion      : `Backup automático — configuración: ${config.nombre}`,
      usuario_id       : null,
      configuracion_id : config.id,
      metadata         : {
        database                 : process.env.DB_NAME,
        host                     : process.env.DB_HOST,
        cloudinary_public_id     : uploadResult.public_id,
        cloudinary_resource_type : uploadResult.resource_type,
      },
      expires_at,
      log_url,
      log_cloud_key,
    });

    // ── 5. Actualizar stats ─────────────────────────────────────
    const proximo_respaldo = calcularProximo(config);
    await Backup.updateLastBackupStatus(config.id, 'exitoso');
    await Backup.updateNextBackup(config.id, proximo_respaldo);

    console.log(`✅ [Scheduler] Backup completado: ${fileName} (${tamaño_legible})`);
    console.log(`   Próximo respaldo: ${proximo_respaldo.toISOString()}`);

    // ── 6. Email ────────────────────────────────────────────────
    if (config.notificar_email && config.emails_notificacion?.length) {
      await emailService.sendBackupNotification({ config, backup, proximo_respaldo, success: true })
        .catch(err => console.warn('⚠ Email falló:', err.message));
    }

  } catch (error) {
    console.error(`❌ [Scheduler] Error en backup "${config.nombre}":`, error.message);

    // Log de fallo
    const duracion_ms = Date.now() - start;
    logLines.push(`[ERROR] ${error.message}`);
    logLines.push(`[${new Date().toISOString()}] Backup fallido tras ${duracion_ms}ms`);

    await subirLog({
      fileName : fileName.replace('.sql', ''),
      tipo     : 'backup_automatico',
      estado   : 'fallido',
      lineas   : logLines,
      folder   : process.env.BACKUP_CLOUDINARY_FOLDER,
    }).catch(() => {});

    await Backup.updateLastBackupStatus(config.id, 'fallido', error.message).catch(() => {});

    if (config.notificar_email && config.emails_notificacion?.length) {
      await emailService.sendBackupNotification({ config, error: error.message, success: false })
        .catch(() => {});
    }

  } finally {
    if (fs.existsSync(localPath)) {
      try { fs.unlinkSync(localPath); } catch (_) {}
    }
  }
}

// ─────────────────────────────────────────────────────────────
// VACUUM automático
// ─────────────────────────────────────────────────────────────
async function runVacuumForConfig(config) {
  console.log(`\n🧹 [Scheduler] Ejecutando VACUUM automático: "${config.nombre}" (id=${config.id})`);
  try {
    const { estado, errorMsg, duracion_ms } = await ejecutarVacuum({
      config,
      tipo : 'Automatico',
    });

    const proximo = calcularProximo(config);
    await VacuumConfig.updateLastStatus(config.id, estado === 'Completado' ? 'exitoso' : 'fallido', errorMsg);
    await VacuumConfig.updateNextVacuum(config.id, proximo);

    console.log(`✅ [Scheduler] VACUUM completado en ${duracion_ms}ms. Próximo: ${proximo.toISOString()}`);
  } catch (err) {
    console.error(`❌ [Scheduler] Error en VACUUM config ${config.id}:`, err.message);
    await VacuumConfig.updateLastStatus(config.id, 'fallido', err.message).catch(() => {});
  }
}

// ─────────────────────────────────────────────────────────────
// Inicializar tarea
// ─────────────────────────────────────────────────────────────
export function initBackupScheduler() {
  console.log('Scheduler] Iniciando scheduler de backups y vacuums (cada 3 min)...');

  // ── Cada 5 min: revisar backups Y vacuums ─────────────────────
  const task = cron.schedule('*/5 * * * *', async () => {
    try {
      // Backups
      const backupConfigs = await BackupConfig.findActive();
      for (const config of backupConfigs) {
        if (shouldRun(config.proximo_respaldo, config.activo)) {
          runBackupForConfig(config).catch(err =>
            console.error(`[Scheduler] Error inesperado en backup config ${config.id}:`, err)
          );
        }
      }

      // Vacuums
      const vacuumConfigs = await VacuumConfig.findActive();
      for (const config of vacuumConfigs) {
        if (shouldRun(config.proximo_vacuum, config.activo)) {
          runVacuumForConfig(config).catch(err =>
            console.error(`[Scheduler] Error inesperado en vacuum config ${config.id}:`, err)
          );
        }
      }
    } catch (err) {
      console.error('[Scheduler] Error en tick:', err.message);
    }
  });

  // Limpieza de backups expirados
  cron.schedule('0 3 * * *', async () => {
    console.log('[Scheduler] Limpiando backups expirados...');
    try {
      const expired = await Backup.deleteExpired();
      for (const b of expired) {
        await cloudinary.uploader.destroy(b.cloud_key, { resource_type: 'raw' }).catch(() => {});
        if (b.log_cloud_key) {
          await cloudinary.uploader.destroy(b.log_cloud_key, { resource_type: 'raw' }).catch(() => {});
        }
      }
      if (expired.length) {
        console.log(`✅ [Scheduler] ${expired.length} backups expirados eliminados`);
      }
    } catch (err) {
      console.error('[Scheduler] Error al limpiar expirados:', err.message);
    }
  });

  return task;
}