import pkg from 'pg';
const { Pool } = pkg;
import dotenv from 'dotenv';

dotenv.config();

export const pool = new Pool({
  host:     process.env.DB_HOST,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port:     process.env.DB_PORT,
  //ssl: { rejectUnauthorized: false }
});

pool.on('connect', (client) => {
  client.query("SET search_path TO core, catalogo, admin, public");
  console.log('Conectado a PostgreSQL');
});

pool.on('error', (err) => {
  console.error('Error en PostgreSQL:', err);
  process.exit(-1);
});

export const query = async (text, params) => {
  try {
    console.log('\nSQL EJECUTADO:');
    console.log(text);
    console.log('PARAMS:', params);

    const start = Date.now();
    const res = await pool.query(text, params);
    const duration = Date.now() - start;

    console.log('Tiempo:', duration, 'ms');

    return res;
  } catch (error) {
    console.error('ERROR SQL:', error.message);
    console.error('POSICIÓN:', error.position);
    console.error('QUERY:', text);
    console.error('PARAMS:', params);
    throw error;
  }
};

export const transaction = async (callback) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};