import { Router } from 'express';
import {
  getSnapshot,
  getServer,
  getTransactions,
  getAlerts,
  getConnections,
  getSlowQueries,
  getIndexes,
  getTables,
  getDeadTuples,
  getLocks,
  getSchemas,
  getPool,
} from '../controllers/statsController.js';

const router = Router();

/**
 * @route  GET /api/stats/snapshot
 * @desc   Dashboard completo: server + transactions + alerts + indexes + tables + locks + schemas
 */
router.get('/snapshot', getSnapshot);

/**
 * @route  GET /api/stats/server
 * @desc   Versión, uptime, tamaño BD, conexiones activas/idle/max
 */
router.get('/server', getServer);

/**
 * @route  GET /api/stats/transactions
 * @desc   Commits, rollbacks, cache hit ratio, filas leídas/insertadas/actualizadas/eliminadas
 */
router.get('/transactions', getTransactions);

/**
 * @route  GET /api/stats/alerts
 * @desc   Deadlocks, conflictos, archivos temp, rollbacks
 */
router.get('/alerts', getAlerts);

/**
 * @route  GET /api/stats/connections
 * @desc   Lista de conexiones activas con estado, tiempo, query preview
 */
router.get('/connections', getConnections);

/**
 * @route  GET /api/stats/slow-queries
 * @desc   Top 10 consultas más lentas (requiere extensión pg_stat_statements)
 */
router.get('/slow-queries', getSlowQueries);

/**
 * @route  GET /api/stats/indexes
 * @desc   Eficiencia de índices: uso vs escaneo secuencial por tabla
 */
router.get('/indexes', getIndexes);

/**
 * @route  GET /api/stats/tables
 * @desc   Top tablas por tamaño con info de vacuum/analyze
 */
router.get('/tables', getTables);

/**
 * @route  GET /api/stats/dead-tuples
 * @desc   Tablas con alta cantidad de filas muertas (candidatas a VACUUM)
 */
router.get('/dead-tuples', getDeadTuples);

/**
 * @route  GET /api/stats/locks
 * @desc   Locks activos en la BD
 */
router.get('/locks', getLocks);

/**
 * @route  GET /api/stats/schemas
 * @desc   Resumen de schemas con sus tablas
 */
router.get('/schemas', getSchemas);

/**
 * @route  GET /api/stats/pool
 * @desc   Estado del pool de conexiones de Node.js (total/idle/waiting)
 */
router.get('/pool', getPool);

export default router;