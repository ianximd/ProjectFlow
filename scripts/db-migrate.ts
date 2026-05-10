/**
 * db-migrate.ts — Run all pending SQL migrations in order.
 *
 * Usage:
 *   npx tsx scripts/db-migrate.ts
 *   # or via npm script:
 *   npm run db:migrate
 *
 * Environment variables (same as the API):
 *   DB_SERVER, DB_USER, DB_PASSWORD, DB_NAME,
 *   DB_ENCRYPT, DB_TRUST_SERVER_CERTIFICATE
 *
 * Strategy:
 *   1. Ensure a MigrationHistory table exists in the target database.
 *   2. Read all *.sql files from infra/sql/migrations/ sorted numerically.
 *   3. Skip any migration already recorded in MigrationHistory.
 *   4. Execute each pending migration inside a transaction; roll back on error.
 *   5. Record the migration filename + checksum on success.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import sql from 'mssql';

// ── Connection config ─────────────────────────────────────────────────────────

const config: sql.config = {
  server:   process.env.DB_SERVER   || 'localhost',
  user:     process.env.DB_USER     || 'sa',
  password: process.env.DB_PASSWORD || 'YourStrong@Passw0rd',
  database: process.env.DB_NAME     || 'ProjectFlow',
  options: {
    encrypt:                process.env.DB_ENCRYPT === 'true',
    trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE !== 'false',
  },
  pool: { max: 3, min: 1, idleTimeoutMillis: 10000 },
  requestTimeout: 60_000, // migrations can be slow
};

// ── Paths ────────────────────────────────────────────────────────────────────

const MIGRATIONS_DIR = path.resolve(
  path.dirname(decodeURIComponent(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'))),
  '../infra/sql/migrations',
);

// ── Helpers ──────────────────────────────────────────────────────────────────

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

async function ensureMigrationTable(pool: sql.ConnectionPool): Promise<void> {
  await pool.request().query(`
    IF NOT EXISTS (
      SELECT 1 FROM sys.tables WHERE name = 'MigrationHistory' AND schema_id = SCHEMA_ID('dbo')
    )
    CREATE TABLE dbo.MigrationHistory (
      Id          INT IDENTITY PRIMARY KEY,
      FileName    NVARCHAR(255) NOT NULL UNIQUE,
      Checksum    NVARCHAR(64)  NOT NULL,
      AppliedAt   DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME()
    );
  `);
}

async function getApplied(pool: sql.ConnectionPool): Promise<Set<string>> {
  const result = await pool.request().query<{ FileName: string }>(
    'SELECT FileName FROM dbo.MigrationHistory ORDER BY Id',
  );
  return new Set(result.recordset.map((r) => r.FileName));
}

async function recordMigration(
  pool: sql.ConnectionPool,
  fileName: string,
  checksum: string,
): Promise<void> {
  await pool.request()
    .input('FileName', sql.NVarChar(255), fileName)
    .input('Checksum', sql.NVarChar(64),  checksum)
    .query('INSERT INTO dbo.MigrationHistory (FileName, Checksum) VALUES (@FileName, @Checksum)');
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('ProjectFlow — Database Migrator');
  console.log(`Migrations dir: ${MIGRATIONS_DIR}\n`);

  const pool = await new sql.ConnectionPool(config).connect();
  console.log(`Connected to ${config.server}/${config.database}`);

  await ensureMigrationTable(pool);
  const applied = await getApplied(pool);

  // Load and sort migration files
  const entries = await fs.readdir(MIGRATIONS_DIR);
  const sqlFiles = entries
    .filter((f) => f.endsWith('.sql'))
    .sort(); // lexicographic = numeric because files are zero-padded (0001_, 0002_, …)

  const pending = sqlFiles.filter((f) => !applied.has(f));

  if (pending.length === 0) {
    console.log('All migrations are up to date.');
    await pool.close();
    return;
  }

  console.log(`Found ${pending.length} pending migration(s):\n`);

  for (const file of pending) {
    const filePath = path.join(MIGRATIONS_DIR, file);
    const content  = await fs.readFile(filePath, 'utf8');
    const checksum = sha256(content);

    process.stdout.write(`  → ${file} ... `);

    // Split on GO statements (T-SQL batch separator)
    const batches = content
      .split(/^\s*GO\s*$/im)
      .map((b) => b.trim())
      .filter(Boolean);

    const tx = pool.transaction();
    try {
      await tx.begin();
      for (const batch of batches) {
        await tx.request().query(batch);
      }
      await recordMigration(pool, file, checksum);
      await tx.commit();
      console.log('OK');
    } catch (err) {
      await tx.rollback();
      console.log('FAILED');
      console.error(`\nError in ${file}:`, (err as Error).message);
      process.exitCode = 1;
      break;
    }
  }

  await pool.close();

  if (!process.exitCode) {
    console.log('\nAll migrations applied successfully.');
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
