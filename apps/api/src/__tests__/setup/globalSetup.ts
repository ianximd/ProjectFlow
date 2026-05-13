/**
 * Vitest globalSetup for the integration project.
 *
 * Runs ONCE before any integration test file:
 *   1. Ensures `ProjectFlow_Test` exists on the configured SQL Server.
 *   2. Runs every pending migration against it.
 *   3. Idempotently deploys every stored procedure.
 *
 * The migration + SP deploy scripts already read DB config from env, so we
 * just set DB_NAME=ProjectFlow_Test and re-use them as child processes.
 * That keeps the schema/SP code-path identical to production deploys.
 */

import { execSync } from 'node:child_process';
import path from 'node:path';
import sql from 'mssql';

const REPO_ROOT = path.resolve(__dirname, '../../../../..');
const TEST_DB   = 'ProjectFlow_Test';

const adminConfig: sql.config = {
  server:   process.env.DB_SERVER   || 'localhost',
  user:     process.env.DB_USER     || 'sa',
  password: process.env.DB_PASSWORD || 'YourStrong@Passw0rd',
  database: 'master',
  options: {
    encrypt:                process.env.DB_ENCRYPT === 'true',
    trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE !== 'false',
  },
  pool: { max: 1, min: 1, idleTimeoutMillis: 5000 },
  requestTimeout: 30_000,
};

async function ensureTestDatabase(): Promise<void> {
  const pool = await new sql.ConnectionPool(adminConfig).connect();
  try {
    // CREATE DATABASE IF NOT EXISTS isn't a thing in T-SQL — use a NOT EXISTS
    // guard against sys.databases instead.
    await pool.request().query(`
      IF NOT EXISTS (SELECT 1 FROM sys.databases WHERE name = '${TEST_DB}')
        CREATE DATABASE [${TEST_DB}];
    `);
  } finally {
    await pool.close();
  }
}

function runScript(script: string): void {
  const env = {
    ...process.env,
    DB_NAME: TEST_DB,
    // Suppress the "Using default JWT_SECRET" warning so test output stays clean.
    JWT_SECRET: process.env.JWT_SECRET || 'integration-test-secret-32-chars!!',
  };
  execSync(`npx tsx ${script}`, {
    cwd:   REPO_ROOT,
    stdio: 'inherit',
    env,
  });
}

export async function setup(): Promise<void> {
  console.log(`[integration] preparing ${TEST_DB} on ${adminConfig.server}…`);
  await ensureTestDatabase();
  runScript('scripts/db-migrate.ts');
  runScript('scripts/db-deploy-sps.ts');
  console.log(`[integration] ${TEST_DB} ready.`);
}

export async function teardown(): Promise<void> {
  // We deliberately keep the test DB around so the next run can skip the
  // expensive SP deploy when migrations + SP files haven't changed.
  // CI nukes the container anyway; locally the developer can drop it manually.
}
