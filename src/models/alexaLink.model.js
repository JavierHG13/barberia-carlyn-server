import crypto from 'crypto';
import { pool } from '../config/database.js';

const CODE_TTL_MINUTES = 10;

const normalizeAlexaUserId = (value) => {
  const normalized = String(value || '').trim();
  return normalized.length > 0 ? normalized : null;
};

const normalizeCode = (value) => String(value || '').trim().toUpperCase().replace(/\s+/g, '');

const generateCode = () => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.randomBytes(6))
    .map((byte) => alphabet[byte % alphabet.length])
    .join('');
};

class AlexaLink {
  static ready = false;

  static async ensureTables() {
    if (this.ready) return;

    await pool.query(`
      CREATE TABLE IF NOT EXISTS alexa_account_links (
        id SERIAL PRIMARY KEY,
        alexa_user_id TEXT NOT NULL UNIQUE,
        usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
        active BOOLEAN NOT NULL DEFAULT true,
        linked_at TIMESTAMP NOT NULL DEFAULT NOW(),
        last_used_at TIMESTAMP NULL
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS alexa_pairing_codes (
        code VARCHAR(8) PRIMARY KEY,
        alexa_user_id TEXT NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        used_at TIMESTAMP NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    this.ready = true;
  }

  static async findLinkedUser(alexaUserId) {
    const normalizedAlexaUserId = normalizeAlexaUserId(alexaUserId);
    if (!normalizedAlexaUserId) return null;

    await this.ensureTables();

    const result = await pool.query(
      `SELECT l.alexa_user_id, l.usuario_id, u.nombre, u.email, u.telefono, r.nombre AS rol
       FROM alexa_account_links l
       JOIN usuarios u ON u.id = l.usuario_id
       JOIN roles r ON r.id = u.rol_id
       WHERE l.alexa_user_id = $1
         AND l.active = true
         AND u.activo = true
       LIMIT 1`,
      [normalizedAlexaUserId]
    );

    if (result.rows[0]) {
      await pool.query(
        'UPDATE alexa_account_links SET last_used_at = NOW() WHERE alexa_user_id = $1',
        [normalizedAlexaUserId]
      );
    }

    return result.rows[0] ?? null;
  }

  static async createPairingCode(alexaUserId) {
    const normalizedAlexaUserId = normalizeAlexaUserId(alexaUserId);
    if (!normalizedAlexaUserId) {
      throw { status: 400, message: 'alexaUserId es requerido' };
    }

    await this.ensureTables();

    await pool.query(
      `UPDATE alexa_pairing_codes
       SET used_at = NOW()
       WHERE alexa_user_id = $1 AND used_at IS NULL`,
      [normalizedAlexaUserId]
    );

    let code = generateCode();
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        const result = await pool.query(
          `INSERT INTO alexa_pairing_codes (code, alexa_user_id, expires_at)
           VALUES ($1, $2, NOW() + ($3 || ' minutes')::INTERVAL)
           RETURNING code, expires_at`,
          [code, normalizedAlexaUserId, CODE_TTL_MINUTES]
        );
        return result.rows[0];
      } catch (error) {
        if (error.code !== '23505' || attempt === 3) throw error;
        code = generateCode();
      }
    }

    throw { status: 500, message: 'No se pudo generar el código de vinculación' };
  }

  static async confirmPairingCode(code, usuarioId) {
    const normalizedCode = normalizeCode(code);
    const parsedUsuarioId = Number.parseInt(usuarioId, 10);

    if (!normalizedCode) throw { status: 400, message: 'Código requerido' };
    if (!parsedUsuarioId) throw { status: 400, message: 'Usuario inválido' };

    await this.ensureTables();

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const codeResult = await client.query(
        `SELECT code, alexa_user_id
         FROM alexa_pairing_codes
         WHERE code = $1
           AND used_at IS NULL
           AND expires_at > NOW()
         FOR UPDATE`,
        [normalizedCode]
      );

      const pairingCode = codeResult.rows[0];
      if (!pairingCode) {
        throw { status: 400, message: 'El código no existe o ya expiró' };
      }

      await client.query(
        `INSERT INTO alexa_account_links (alexa_user_id, usuario_id, active, linked_at, last_used_at)
         VALUES ($1, $2, true, NOW(), NOW())
         ON CONFLICT (alexa_user_id)
         DO UPDATE SET usuario_id = EXCLUDED.usuario_id,
                       active = true,
                       linked_at = NOW(),
                       last_used_at = NOW()`,
        [pairingCode.alexa_user_id, parsedUsuarioId]
      );

      await client.query('UPDATE alexa_pairing_codes SET used_at = NOW() WHERE code = $1', [normalizedCode]);
      await client.query('COMMIT');

      return { alexaUserId: pairingCode.alexa_user_id };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  static async unlinkByUser(usuarioId) {
    await this.ensureTables();
    await pool.query(
      `UPDATE alexa_account_links
       SET active = false
       WHERE usuario_id = $1`,
      [usuarioId]
    );
  }
}

export default AlexaLink;
