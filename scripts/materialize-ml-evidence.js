import 'dotenv/config';
import pkg from 'pg';

const { Pool } = pkg;

const pool = new Pool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT,
});

const SHOULD_RESET = process.argv.includes('--reset');
const EVIDENCE_PREFIX = '[EVIDENCIA_ML]';
const EMAIL_DOMAIN = 'barberia-carlyn.local';
const PASSWORD_HASH = '$2b$10$zXGJbBneJA.Tb40XN.qdweMs6PBAKdJTDRrEWwPuNu8bUX1mO1TNq';

async function ensureAnalyticsDataset(client) {
  const { rows } = await client.query(`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'analitica'
        AND table_name = 'ml_citas_dataset'
    ) AS exists
  `);

  if (!rows[0]?.exists) {
    throw new Error('No existe analitica.ml_citas_dataset. Ejecuta primero npm run ml:train.');
  }
}

async function getClienteRoleId(client) {
  const { rows } = await client.query(
    "SELECT id FROM roles WHERE LOWER(nombre) = 'cliente' LIMIT 1"
  );
  return rows[0]?.id || 3;
}

async function getExistingEvidenceCounts(client) {
  const users = await client.query(
    `SELECT COUNT(*)::int AS total
     FROM usuarios
     WHERE email LIKE 'evidencia.ml.%@${EMAIL_DOMAIN}'`
  );

  const appointments = await client.query(
    `SELECT COUNT(*)::int AS total
     FROM citas
     WHERE notas LIKE $1`,
    [`${EVIDENCE_PREFIX}%`]
  );

  return {
    usuarios: users.rows[0].total,
    citas: appointments.rows[0].total,
  };
}

async function resetEvidence(client) {
  await client.query(
    `DELETE FROM citas
     WHERE notas LIKE $1`,
    [`${EVIDENCE_PREFIX}%`]
  );

  await client.query(
    `DELETE FROM usuarios
     WHERE email LIKE 'evidencia.ml.%@${EMAIL_DOMAIN}'`
  );
}

async function insertUsers(client, rolId) {
  const { rows } = await client.query(
    `
    INSERT INTO usuarios (nombre, email, telefono, password, rol_id, activo, created_at, updated_at)
    SELECT
      cliente_nombre,
      'evidencia.ml.' || cliente_ref || '@${EMAIL_DOMAIN}' AS email,
      '771' || LPAD(cliente_ref::text, 7, '0') AS telefono,
      $1 AS password,
      $2 AS rol_id,
      true AS activo,
      MIN(fecha)::timestamp AS created_at,
      NOW() AS updated_at
    FROM analitica.ml_citas_dataset
    GROUP BY cliente_ref, cliente_nombre
    ORDER BY cliente_ref
    RETURNING id
    `,
    [PASSWORD_HASH, rolId]
  );

  return rows.length;
}

async function insertAppointments(client) {
  const { rows } = await client.query(
    `
    WITH estados AS (
      SELECT
        MAX(CASE WHEN LOWER(nombre) = 'pendiente' THEN id END) AS pendiente_id,
        MAX(CASE WHEN LOWER(nombre) = 'completada' THEN id END) AS completada_id,
        MAX(CASE WHEN LOWER(nombre) = 'cancelada' THEN id END) AS cancelada_id,
        MAX(CASE WHEN LOWER(nombre) = 'no_asistio' THEN id END) AS no_asistio_id
      FROM estados_cita
    ),
    pagos AS (
      SELECT COALESCE(MAX(CASE WHEN LOWER(nombre) = 'tarjeta' THEN id END), MIN(id)) AS pago_id
      FROM metodos_pago
    ),
    barberos_activos AS (
      SELECT ARRAY_AGG(id ORDER BY id) AS ids, COUNT(*)::int AS total
      FROM barberos
      WHERE activo = true
    ),
    source AS (
      SELECT d.*, (ROW_NUMBER() OVER (ORDER BY d.id) - 1)::int AS rn
      FROM analitica.ml_citas_dataset d
    ),
    scheduled AS (
      SELECT
        s.*,
        b.ids[(s.rn % b.total) + 1] AS scheduled_barbero_id,
        (DATE '2024-01-01' + ((s.rn / (b.total * 6))::int)) AS scheduled_fecha,
        (TIME '09:00' + ((((s.rn / b.total)::int % 6) * 105) || ' minutes')::interval)::time AS scheduled_hora
      FROM source s
      CROSS JOIN barberos_activos b
    )
    INSERT INTO citas (
      cliente_id,
      barbero_id,
      servicio_id,
      local_id,
      fecha,
      hora_inicio,
      hora_fin,
      estado_id,
      notas,
      metodo_pago_id,
      monto_pagado,
      recordatorio_enviado,
      motivo_cancelacion,
      created_at,
      updated_at,
      bloquea_agenda
    )
    SELECT
      u.id,
      d.scheduled_barbero_id,
      d.servicio_id,
      d.local_id,
      d.scheduled_fecha,
      d.scheduled_hora,
      (d.scheduled_hora + (d.duracion || ' minutes')::interval)::time,
      CASE d.estado_cita
        WHEN 'asistio' THEN e.completada_id
        WHEN 'cancelada' THEN e.cancelada_id
        WHEN 'no_show' THEN e.no_asistio_id
        ELSE e.pendiente_id
      END AS estado_id,
      $1 || ' dataset_id=' || d.id || '; canal=' || d.canal || '; riesgo_cliente=' || ROUND((d.no_show_rate_cliente * 100)::numeric, 2) || '%' AS notas,
      CASE WHEN d.estado_cita = 'asistio' THEN p.pago_id ELSE NULL END AS metodo_pago_id,
      d.monto_pagado,
      d.recordatorio_enviado,
      CASE
        WHEN d.estado_cita = 'cancelada' THEN 'Cancelacion sintetica para evidencia ML'
        WHEN d.estado_cita = 'no_show' THEN 'No asistio sintetico para evidencia ML'
        ELSE NULL
      END AS motivo_cancelacion,
      (d.scheduled_fecha + d.scheduled_hora)::timestamp,
      NOW(),
      true
    FROM scheduled d
    JOIN usuarios u
      ON u.email = 'evidencia.ml.' || d.cliente_ref || '@${EMAIL_DOMAIN}'
    CROSS JOIN estados e
    CROSS JOIN pagos p
    ORDER BY d.id
    RETURNING id
    `,
    [EVIDENCE_PREFIX]
  );

  return rows.length;
}

async function main() {
  const client = await pool.connect();

  try {
    await client.query('SET search_path TO core, catalogo, admin, public');
    await ensureAnalyticsDataset(client);

    const before = await getExistingEvidenceCounts(client);
    if ((before.usuarios > 0 || before.citas > 0) && !SHOULD_RESET) {
      console.log(JSON.stringify({
        ok: false,
        message: 'Ya existen registros de evidencia. Ejecuta npm run ml:evidence:reset para regenerarlos.',
        existing: before,
      }, null, 2));
      return;
    }

    await client.query('BEGIN');
    if (SHOULD_RESET) {
      await resetEvidence(client);
    }

    const rolId = await getClienteRoleId(client);
    const usuarios = await insertUsers(client, rolId);
    const citas = await insertAppointments(client);

    await client.query('COMMIT');

    const after = await getExistingEvidenceCounts(client);
    console.log(JSON.stringify({
      ok: true,
      inserted: { usuarios, citas },
      totals: after,
      evidenceFilters: {
        usuarios: `email LIKE 'evidencia.ml.%@${EMAIL_DOMAIN}'`,
        citas: `notas LIKE '${EVIDENCE_PREFIX}%'`,
      },
    }, null, 2));
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error materializando evidencia ML:', error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
