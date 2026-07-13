import { pool, query } from '../config/database.js';

/* =========================
   BACKUP
========================= */

export const getAllTables = async () => {
  return await query(`
    SELECT tablename FROM pg_tables 
    WHERE schemaname = 'public'
    ORDER BY tablename
  `);
};

export const getTableData = async (tableName) => {
  return await query(`SELECT * FROM "${tableName}"`);
};

export const getSequences = async () => {
  return await query(`
    SELECT 
      seq.sequence_name,
      attr.attname        AS column_name,
      cls.relname         AS table_name
    FROM information_schema.sequences seq
    JOIN pg_class seq_cls 
      ON seq_cls.relname = seq.sequence_name
    JOIN pg_depend dep 
      ON dep.objid = seq_cls.oid AND dep.deptype = 'a'
    JOIN pg_class cls 
      ON cls.oid = dep.refobjid
    JOIN pg_attribute attr 
      ON attr.attrelid = cls.oid AND attr.attnum = dep.refobjsubid
    WHERE seq.sequence_schema = 'public'
  `);
};

/* =========================
   RESTORE
========================= */

export const executeTransaction = async (callback) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await callback(client);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

/* =========================
   STATS
========================= */

export const getDatabaseSize = async () => {
  return await query(`
    SELECT pg_size_pretty(pg_database_size(current_database())) as size
  `);
};

export const getTableCount = async (table) => {
  return await query(`SELECT COUNT(*) as count FROM "${table}"`);
};

export const getConnections = async () => {
  return await query(`
    SELECT 
      count(*) as total_connections,
      count(*) FILTER (WHERE state = 'active')  as active_connections,
      count(*) FILTER (WHERE state = 'idle')    as idle_connections
    FROM pg_stat_activity
    WHERE datname = current_database()
  `);
};

export const runCustomQuery = async (sql) => {
  return await query(sql);
};