import 'dotenv/config';
import bcrypt from 'bcrypt';
import pkg from 'pg';

const { Pool } = pkg;

const pool = new Pool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT,
});

const localData = {
  nombre: 'Barbería Carlyn',
  direccion: 'Adolfo López Mateos 33, Aviación Civil',
  ciudad: 'Huejutla de Reyes',
  estado: 'Hidalgo',
  codigo_postal: '43000',
  telefono: null,
  email: null,
  latitud: null,
  longitud: null,
  hora_apertura: '09:00:00',
  hora_cierre: '19:00:00',
};

const barberos = [
  {
    nombre: 'Carlos Méndez',
    email: 'carlos.mendez@barberiacarlyn.local',
    telefono: '7711000001',
    especialidad: 'Corte clásico y barba',
    años_experiencia: 5,
    descripcion: 'Barbero de ejemplo para cortes clásicos, perfilados y arreglo de barba.',
    calificacion: 4.8,
  },
  {
    nombre: 'Luis Hernández',
    email: 'luis.hernandez@barberiacarlyn.local',
    telefono: '7711000002',
    especialidad: 'Degradados y diseño',
    años_experiencia: 4,
    descripcion: 'Barbero de ejemplo especializado en degradados, fades y diseños modernos.',
    calificacion: 4.7,
  },
  {
    nombre: 'Diego Martínez',
    email: 'diego.martinez@barberiacarlyn.local',
    telefono: '7711000003',
    especialidad: 'Corte infantil y arreglo personal',
    años_experiencia: 3,
    descripcion: 'Barbero de ejemplo para cortes rápidos, corte infantil y mantenimiento.',
    calificacion: 4.6,
  },
];

const horarios = [1, 2, 3, 4, 5, 6].map((dia_semana) => ({
  dia_semana,
  hora_inicio: '09:00:00',
  hora_fin: dia_semana === 6 ? '15:00:00' : '19:00:00',
  activo: true,
}));

async function getBarberoRoleId(client) {
  const { rows } = await client.query(
    "SELECT id FROM roles WHERE LOWER(nombre) = 'barbero' LIMIT 1"
  );

  if (rows[0]) return rows[0].id;
  return 2;
}

async function upsertLocal(client) {
  const existing = await client.query(
    `SELECT id
     FROM locales
     WHERE nombre = $1 OR direccion = $2
     ORDER BY id
     LIMIT 1`,
    [localData.nombre, localData.direccion]
  );

  if (existing.rows[0]) {
    const { rows } = await client.query(
      `UPDATE locales
       SET nombre = $1,
           direccion = $2,
           ciudad = $3,
           estado = $4,
           codigo_postal = $5,
           telefono = $6,
           email = $7,
           latitud = $8,
           longitud = $9,
           hora_apertura = $10,
           hora_cierre = $11,
           activo = true,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $12
       RETURNING *`,
      [
        localData.nombre,
        localData.direccion,
        localData.ciudad,
        localData.estado,
        localData.codigo_postal,
        localData.telefono,
        localData.email,
        localData.latitud,
        localData.longitud,
        localData.hora_apertura,
        localData.hora_cierre,
        existing.rows[0].id,
      ]
    );
    return rows[0];
  }

  const principal = await client.query(
    'SELECT EXISTS (SELECT 1 FROM locales WHERE es_principal = true) AS exists'
  );

  const { rows } = await client.query(
    `INSERT INTO locales
      (nombre, direccion, ciudad, estado, codigo_postal, telefono, email,
       latitud, longitud, hora_apertura, hora_cierre, es_principal, activo)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, true)
     RETURNING *`,
    [
      localData.nombre,
      localData.direccion,
      localData.ciudad,
      localData.estado,
      localData.codigo_postal,
      localData.telefono,
      localData.email,
      localData.latitud,
      localData.longitud,
      localData.hora_apertura,
      localData.hora_cierre,
      !principal.rows[0].exists,
    ]
  );

  return rows[0];
}

async function upsertUsuario(client, barbero, rolId, passwordHash) {
  const existing = await client.query(
    'SELECT id FROM usuarios WHERE email = $1 OR telefono = $2 LIMIT 1',
    [barbero.email, barbero.telefono]
  );

  if (existing.rows[0]) {
    const { rows } = await client.query(
      `UPDATE usuarios
       SET nombre = $1,
           email = $2,
           telefono = $3,
           rol_id = $4,
           activo = true,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $5
       RETURNING *`,
      [barbero.nombre, barbero.email, barbero.telefono, rolId, existing.rows[0].id]
    );
    return rows[0];
  }

  const { rows } = await client.query(
    `INSERT INTO usuarios (nombre, email, telefono, password, rol_id, activo)
     VALUES ($1, $2, $3, $4, $5, true)
     RETURNING *`,
    [barbero.nombre, barbero.email, barbero.telefono, passwordHash, rolId]
  );

  return rows[0];
}

async function upsertBarbero(client, usuarioId, localId, barbero) {
  const existing = await client.query(
    'SELECT id FROM barberos WHERE usuario_id = $1 LIMIT 1',
    [usuarioId]
  );

  if (existing.rows[0]) {
    const { rows } = await client.query(
      `UPDATE barberos
       SET especialidad = $1,
           años_experiencia = $2,
           descripcion = $3,
           calificacion = $4,
           local_id = $5,
           activo = true
       WHERE id = $6
       RETURNING *`,
      [
        barbero.especialidad,
        barbero.años_experiencia,
        barbero.descripcion,
        barbero.calificacion,
        localId,
        existing.rows[0].id,
      ]
    );
    return rows[0];
  }

  const { rows } = await client.query(
    `INSERT INTO barberos
      (usuario_id, especialidad, años_experiencia, descripcion, calificacion, local_id, activo)
     VALUES ($1, $2, $3, $4, $5, $6, true)
     RETURNING *`,
    [
      usuarioId,
      barbero.especialidad,
      barbero.años_experiencia,
      barbero.descripcion,
      barbero.calificacion,
      localId,
    ]
  );

  return rows[0];
}

async function upsertHorarios(client, barberoId) {
  for (const horario of horarios) {
    await client.query(
      `INSERT INTO horarios_barbero (barbero_id, dia_semana, hora_inicio, hora_fin, activo)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (barbero_id, dia_semana)
       DO UPDATE SET
         hora_inicio = EXCLUDED.hora_inicio,
         hora_fin = EXCLUDED.hora_fin,
         activo = EXCLUDED.activo`,
      [
        barberoId,
        horario.dia_semana,
        horario.hora_inicio,
        horario.hora_fin,
        horario.activo,
      ]
    );
  }
}

async function main() {
  const client = await pool.connect();

  try {
    await client.query('SET search_path TO core, catalogo, admin, public');
    await client.query('BEGIN');

    const passwordHash = await bcrypt.hash('BarberiaCarlyn123!', 10);
    const rolId = await getBarberoRoleId(client);
    const local = await upsertLocal(client);

    const created = [];
    for (const barbero of barberos) {
      const usuario = await upsertUsuario(client, barbero, rolId, passwordHash);
      const perfil = await upsertBarbero(client, usuario.id, local.id, barbero);
      await upsertHorarios(client, perfil.id);
      created.push({
        usuario_id: usuario.id,
        barbero_id: perfil.id,
        nombre: usuario.nombre,
        email: usuario.email,
      });
    }

    await client.query('COMMIT');

    console.log('Seed completado correctamente.');
    console.log(JSON.stringify({ local, barberos: created }, null, 2));
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error ejecutando seed:', error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
