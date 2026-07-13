import fs from 'fs';
import path from 'path';
import { v2 as cloudinary } from 'cloudinary';

/**
 * Crea un archivo .log, lo sube a Cloudinary y lo elimina localmente.
 *
 * @param {object} opts
 * @param {string}   opts.fileName  - Nombre base sin extensión
 * @param {string}   opts.tipo      - 'backup_manual' | 'backup_automatico' | 'vacuum_manual' | 'vacuum_automatico'
 * @param {string}   opts.estado    - 'completado' | 'fallido'
 * @param {string[]} opts.lineas    - Líneas de contenido del log
 * @param {string}   [opts.folder]  - Carpeta base en Cloudinary
 * @returns {Promise<{ url: string, public_id: string }>}
 */
export async function subirLog({ fileName, tipo, estado, lineas, folder }) {
  const tempDir = path.join(process.cwd(), 'temp_backups');
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

  const logName = `${fileName}.log`;
  const logPath = path.join(tempDir, logName);

  const encabezado = [
    '='.repeat(60),
    `  TIPO      : ${tipo.toUpperCase()}`,
    `  ESTADO    : ${estado.toUpperCase()}`,
    `  GENERADO  : ${new Date().toISOString()}`,
    '='.repeat(60),
    '',
  ].join('\n');

  fs.writeFileSync(logPath, encabezado + lineas.join('\n') + '\n', 'utf8');

  const cloudFolder = folder || process.env.BACKUP_CLOUDINARY_FOLDER || 'barberia-backups';

  const result = await cloudinary.uploader.upload(logPath, {
    resource_type : 'raw',
    folder        : `${cloudFolder}/logs`,
    public_id     : logName,
    use_filename  : true,
    overwrite     : true,
  });

  fs.unlinkSync(logPath);

  return { url: result.secure_url, public_id: result.public_id };
}