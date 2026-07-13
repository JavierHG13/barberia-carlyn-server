import { query, pool } from '../config/database.js';

// ─── 1. ESTADO GENERAL DEL SERVIDOR ────────────────────────────────────────
export const getServerStatus = async () => {
    const [version, uptime, size, connections] = await Promise.all([
        query(`
      SELECT version(), current_database() AS db_name
    `),

        query(`
      SELECT 
        date_trunc('second', now() - pg_postmaster_start_time()) AS uptime,
        pg_postmaster_start_time() AS started_at
    `),

        query(`
      SELECT 
        pg_size_pretty(pg_database_size(current_database())) AS size,
        pg_database_size(current_database()) AS size_bytes
    `),

        query(`
      SELECT 
        count(*) FILTER (WHERE state = 'active') AS active,
        count(*) FILTER (WHERE state = 'idle')   AS idle,
        count(*) FILTER (WHERE state IS NOT NULL) AS total,
        (SELECT setting::int FROM pg_settings WHERE name = 'max_connections') AS max

      FROM pg_stat_activity
      WHERE datname = current_database()

      -- 🔥 FILTROS CLAVE
      AND application_name IS NOT NULL
      AND application_name <> ''
      AND application_name <> '—'

      AND application_name NOT ILIKE '%pgAdmin%'
      AND application_name NOT ILIKE '%psql%'

      AND query NOT ILIKE '%pg_stat_activity%'
      AND query NOT ILIKE '%pg_database%'
      AND query NOT ILIKE '%pg_catalog%'
    `),
    ]);

    return {
        version: version.rows[0].version,
        database: version.rows[0].db_name,
        uptime: uptime.rows[0].uptime,
        started_at: uptime.rows[0].started_at,
        size: size.rows[0].size,
        size_bytes: size.rows[0].size_bytes,
        connections: connections.rows[0], // 👈 MISMA estructura
    };
};

// ─── 2. TRANSACCIONES Y CACHÉ ────────────────────────────────────────────────
export const getTransactionStats = async () => {
    const res = await query(`
    SELECT
      xact_commit                                          AS commits,
      xact_rollback                                        AS rollbacks,
      blks_hit                                             AS cache_hits,
      blks_read                                            AS disk_reads,
      ROUND(
        blks_hit::numeric / NULLIF(blks_hit + blks_read, 0) * 100, 2
      )                                                    AS cache_hit_ratio,
      tup_returned                                         AS rows_returned,
      tup_fetched                                          AS rows_fetched,
      tup_inserted                                         AS rows_inserted,
      tup_updated                                          AS rows_updated,
      tup_deleted                                          AS rows_deleted
    FROM pg_stat_database
    WHERE datname = current_database()
  `);
    return res.rows[0];
};

// ─── 3. ALERTAS DEL SISTEMA ──────────────────────────────────────────────────
export const getSystemAlerts = async () => {
    const res = await query(`
    SELECT
      deadlocks,
      conflicts,
      temp_files                AS temp_file_count,
      pg_size_pretty(temp_bytes) AS temp_size,
      xact_rollback              AS rollbacks
    FROM pg_stat_database
    WHERE datname = current_database()
  `);
    return res.rows[0];
};

// ─── 4. CONEXIONES ACTIVAS (DETALLE) ────────────────────────────────────────
export const getActiveConnections = async () => {
    const res = await query(`
    SELECT
      pid,
      usename           AS username,
      application_name,
      client_addr,
      state,
      wait_event_type,
      wait_event,
      date_trunc('second', now() - query_start) AS duration,
      LEFT(query, 120)  AS query_preview
    FROM pg_stat_activity
    WHERE datname = current_database()
      AND pid <> pg_backend_pid()
    ORDER BY query_start ASC
    LIMIT 30
  `);
    return res.rows;
};

// ─── 5. CONSULTAS LENTAS (TOP 10) ───────────────────────────────────────────
export const getSlowQueries = async () => {
    // pg_stat_statements debe estar instalado; si no, devuelve vacío
    try {
        const res = await query(`
      SELECT
        LEFT(query, 150)           AS query_preview,
        calls,
        ROUND(mean_exec_time::numeric, 2) AS avg_ms,
        ROUND(total_exec_time::numeric, 2) AS total_ms,
        rows,
        ROUND(stddev_exec_time::numeric, 2) AS stddev_ms
      FROM pg_stat_statements
      WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
      ORDER BY mean_exec_time DESC
      LIMIT 10
    `);
        return res.rows;
    } catch {
        return [];   // extensión no instalada
    }
};

// ─── 6. EFICIENCIA DE ÍNDICES ────────────────────────────────────────────────
export const getIndexEfficiency = async () => {
    const res = await query(`
    SELECT
      schemaname || '.' || relname             AS table_name,
      seq_scan,
      idx_scan,
      CASE WHEN (seq_scan + idx_scan) = 0 THEN 0
           ELSE ROUND(idx_scan::numeric / (seq_scan + idx_scan) * 100, 1)
      END                                      AS index_usage_pct,
      n_live_tup                               AS live_rows
    FROM pg_stat_user_tables
    ORDER BY seq_scan DESC
    LIMIT 15
  `);
    return res.rows;
};

// ─── 7. TAMAÑO DE TABLAS (TOP) ───────────────────────────────────────────────
export const getTableSizes = async () => {
    const res = await query(`
    SELECT
      schemaname || '.' || relname AS table_name,

      pg_size_pretty(pg_total_relation_size(relid)) AS total_size,
      pg_total_relation_size(relid) AS total_bytes,

      pg_size_pretty(pg_relation_size(relid)) AS table_size,

      pg_size_pretty(
        pg_total_relation_size(relid) - pg_relation_size(relid)
      ) AS index_size,

      n_live_tup AS live_rows,
      n_dead_tup AS dead_rows,
      last_vacuum,
      last_autovacuum,
      last_analyze,
      last_autoanalyze

    FROM pg_stat_user_tables
    ORDER BY pg_total_relation_size(relid) DESC
    LIMIT 15
  `);

    return res.rows;
};

// ─── 8. BLOAT / FILAS MUERTAS (necesitan VACUUM) ────────────────────────────
export const getDeadTuples = async () => {
    const res = await query(`
    SELECT
      schemaname || '.' || relname AS table_name,
      n_dead_tup                   AS dead_rows,
      n_live_tup                   AS live_rows,
      CASE WHEN n_live_tup = 0 THEN 0
           ELSE ROUND(n_dead_tup::numeric / n_live_tup * 100, 2)
      END                          AS dead_ratio_pct,
      last_autovacuum,
      last_vacuum
    FROM pg_stat_user_tables
    WHERE n_dead_tup > 0
    ORDER BY n_dead_tup DESC
    LIMIT 10
  `);
    return res.rows;
};

// ─── 9. LOCKS ACTIVOS ────────────────────────────────────────────────────────
export const getActiveLocks = async () => {
    const res = await query(`
    SELECT
      l.pid,
      a.usename        AS username,
      l.locktype,
      l.mode,
      l.granted,
      date_trunc('second', now() - a.query_start) AS duration,
      LEFT(a.query, 100) AS query_preview
    FROM pg_locks l
    JOIN pg_stat_activity a ON a.pid = l.pid
    WHERE l.pid <> pg_backend_pid()
    ORDER BY granted ASC, duration DESC
    LIMIT 20
  `);
    return res.rows;
};

// ─── 10. SCHEMAS Y TABLAS ────────────────────────────────────────────────────
export const getSchemaSummary = async () => {
    const res = await query(`
    SELECT
      table_schema                    AS schema,
      COUNT(*)                        AS table_count,
      array_agg(table_name ORDER BY table_name) AS tables
    FROM information_schema.tables
    WHERE table_type = 'BASE TABLE'
      AND table_schema NOT IN ('pg_catalog', 'information_schema')
    GROUP BY table_schema
    ORDER BY table_schema
  `);
    return res.rows;
};

// ─── 11. SNAPSHOT COMPLETO (para el dashboard principal) ────────────────────
export const getFullSnapshot = async () => {
    const [server, transactions, alerts, indexEff, tableSizes, locks, schemas] =
        await Promise.all([
            getServerStatus(),
            getTransactionStats(),
            getSystemAlerts(),
            getIndexEfficiency(),
            getTableSizes(),
            getActiveLocks(),
            getSchemaSummary(),
        ]);

    return { server, transactions, alerts, indexEfficiency: indexEff, tableSizes, locks, schemas };
};

// ─── 12. MÉTRICAS DEL POOL DE CONEXIONES ────────────────────────────────────
export const getPoolMetrics = () => {
    return {
        total: pool.totalCount,
        idle: pool.idleCount,
        waiting: pool.waitingCount,
    };
};