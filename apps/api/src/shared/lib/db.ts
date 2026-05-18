import sql from 'mssql';
import { subLogger } from './logger.js';
import { registerCloser } from './shutdown.js';

const log = subLogger('db');

const config: sql.config = {
  user:     process.env.DB_USER || 'sa',
  password: process.env.DB_PASSWORD || 'YourStrong@Passw0rd',
  server:   process.env.DB_SERVER || 'localhost',
  database: process.env.DB_NAME || 'ProjectFlow',
  options: {
    encrypt:                process.env.DB_ENCRYPT === 'true',
    trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE !== 'false',
  },
  pool: {
    // Increased from 20 → 50 to handle concurrent API + GraphQL + worker load
    max:               50,
    min:               5,
    idleTimeoutMillis: 30000,
    acquireTimeoutMillis: 10000, // fail fast rather than pile up waiting requests
  },
  connectionTimeout: 5000,
  requestTimeout:    15000,
};

// ── Slow-query threshold ─────────────────────────────────────────────────────
// Any SP that takes longer than this will be logged to stderr.
const SLOW_QUERY_MS = 500;

let pool: sql.ConnectionPool | null = null;

export async function getPool(): Promise<sql.ConnectionPool> {
  if (!pool) {
    pool = await new sql.ConnectionPool(config).connect();

    pool.on('error', (err) => {
      log.error({ err: err?.message }, 'pool error');
    });

    registerCloser('mssql-pool', () => closePool());
  }
  return pool;
}

/**
 * Close the pool and clear the singleton. Used by integration tests in
 * vitest's afterAll hook so the worker process can exit cleanly. Safe to
 * call when no pool exists.
 */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.close();
    pool = null;
  }
}

/**
 * Emit a warning when a query exceeds the slow-query threshold.
 * Call at the start of an operation and invoke the returned function when done.
 *
 * Usage:
 *   const done = trackQueryTime('usp_Task_List');
 *   const result = await ...;
 *   done();
 */
export function trackQueryTime(label: string): () => void {
  const start = Date.now();
  return () => {
    const elapsed = Date.now() - start;
    if (elapsed >= SLOW_QUERY_MS) {
      log.warn({ sp: label, durationMs: elapsed }, 'slow query');
    }
  };
}
