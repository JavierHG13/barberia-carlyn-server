import * as StatsModel from '../models/stats.model.js';

// Helper para respuestas consistentes
const ok  = (res, data)  => res.json({ success: true,  data });
const err = (res, error, status = 500) => {
  console.error('[StatsController]', error);
  res.status(status).json({ success: false, message: error.message ?? 'Error interno' });
};

// GET /api/stats/snapshot
export const getSnapshot = async (req, res) => {
  try { ok(res, await StatsModel.getFullSnapshot()); }
  catch (e) { err(res, e); }
};

// GET /api/stats/server
export const getServer = async (req, res) => {
  try { ok(res, await StatsModel.getServerStatus()); }
  catch (e) { err(res, e); }
};

// GET /api/stats/transactions
export const getTransactions = async (req, res) => {
  try { ok(res, await StatsModel.getTransactionStats()); }
  catch (e) { err(res, e); }
};

// GET /api/stats/alerts
export const getAlerts = async (req, res) => {
  try { ok(res, await StatsModel.getSystemAlerts()); }
  catch (e) { err(res, e); }
};

// GET /api/stats/connections
export const getConnections = async (req, res) => {
  try { ok(res, await StatsModel.getActiveConnections()); }
  catch (e) { err(res, e); }
};

// GET /api/stats/slow-queries
export const getSlowQueries = async (req, res) => {
  try { ok(res, await StatsModel.getSlowQueries()); }
  catch (e) { err(res, e); }
};

// GET /api/stats/indexes
export const getIndexes = async (req, res) => {
  try { ok(res, await StatsModel.getIndexEfficiency()); }
  catch (e) { err(res, e); }
};

// GET /api/stats/tables
export const getTables = async (req, res) => {
  try {
    console.log('➡️ getTables llamado');

    const data = await StatsModel.getTableSizes();

    console.log('📊 Tables data:', data);

    ok(res, data);
  } catch (e) {
    console.error('❌ Error en getTables:', e);
    err(res, e);
  }
};

// GET /api/stats/dead-tuples
export const getDeadTuples = async (req, res) => {
  try { ok(res, await StatsModel.getDeadTuples()); }
  catch (e) { err(res, e); }
};

// GET /api/stats/locks
export const getLocks = async (req, res) => {
  try { ok(res, await StatsModel.getActiveLocks()); }
  catch (e) { err(res, e); }
};

// GET /api/stats/schemas
export const getSchemas = async (req, res) => {
  try { ok(res, await StatsModel.getSchemaSummary()); }
  catch (e) { err(res, e); }
};

// GET /api/stats/pool
export const getPool = async (req, res) => {
  try { ok(res, StatsModel.getPoolMetrics()); }
  catch (e) { err(res, e); }
};