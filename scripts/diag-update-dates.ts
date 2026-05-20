/**
 * diag-update-dates.ts — NON-DESTRUCTIVE diagnostic for the roadmap "drag a bar,
 * it snaps back" bug.
 *
 * Usage:
 *   npx tsx scripts/diag-update-dates.ts
 *
 * Every write below runs inside a TRANSACTION that is ROLLED BACK, so the
 * database is left exactly as it was. It answers three questions:
 *   1. What is the *deployed* body of usp_Task_UpdateDates? (stale vs current)
 *   2. Does the proc persist when called with STRING dates (exactly how the API
 *      repo binds them: sql.Date / sql.DateTime2 + a "YYYY-MM-DD" string)?
 *   3. Does it persist when called with JS Date objects instead?
 * Plus a raw inline UPDATE as a control to prove the column itself is writable.
 */

import sql from 'mssql';

// Mirror scripts/db-deploy-sps.ts exactly so we hit the same DB the API uses.
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
  requestTimeout: 30_000,
};

const TEST_START = '2029-09-09';            // distinctive values unlikely to
const TEST_DUE   = '2029-12-25';            // collide with real data
const DUMMY_GUID = '00000000-0000-0000-0000-000000000000';

function fmt(v: unknown): string {
  if (v === null || v === undefined) return String(v);
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

async function readDates(req: sql.Request, taskId: string) {
  const r = await req.query(
    `SELECT StartDate, DueDate FROM Tasks WHERE Id = '${taskId}'`,
  );
  return r.recordset[0] as { StartDate: Date | null; DueDate: Date | null };
}

async function main() {
  console.log('ProjectFlow — UpdateDates diagnostic (non-destructive)\n');
  const pool = await new sql.ConnectionPool(config).connect();
  console.log(`Connected to ${config.server}/${config.database}\n`);

  // ── 1. Deployed proc body ────────────────────────────────────────────────
  const def = await pool.request().query(
    `SELECT OBJECT_DEFINITION(OBJECT_ID('usp_Task_UpdateDates')) AS Body`,
  );
  const body: string | null = def.recordset[0]?.Body ?? null;
  console.log('── Deployed usp_Task_UpdateDates ──────────────────────────────');
  console.log(body ? body.trim() : '!! PROC NOT FOUND IN DATABASE !!');
  console.log('───────────────────────────────────────────────────────────────\n');

  // ── 2. Pick a sample task ────────────────────────────────────────────────
  const sample = await pool.request().query(
    `SELECT TOP 1 Id, IssueKey, StartDate, DueDate, UpdatedAt
       FROM Tasks
      WHERE DeletedAt IS NULL
      ORDER BY UpdatedAt DESC`,
  );
  const task = sample.recordset[0] as
    | { Id: string; IssueKey: string; StartDate: Date | null; DueDate: Date | null; UpdatedAt: Date }
    | undefined;
  if (!task) {
    console.log('No non-deleted tasks found — cannot run the binding tests.');
    await pool.close();
    return;
  }
  console.log(`Sample task: ${task.IssueKey} (${task.Id})`);
  console.log(`  before  StartDate=${fmt(task.StartDate)}  DueDate=${fmt(task.DueDate)}\n`);

  // helper: run one SP call inside a rolled-back transaction
  async function trial(
    label: string,
    bind: (req: sql.Request) => void,
  ) {
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      const spReq = new sql.Request(tx);
      spReq.input('TaskId',         sql.UniqueIdentifier, task!.Id);
      spReq.input('RequesterId',    sql.UniqueIdentifier, DUMMY_GUID);
      spReq.input('ClearStartDate', sql.Bit, 0);
      spReq.input('ClearDueDate',   sql.Bit, 0);
      bind(spReq); // adds StartDate + DueDate in the shape under test
      await spReq.execute('usp_Task_UpdateDates');
      const after = await readDates(new sql.Request(tx), task!.Id);
      const changed =
        fmt(after.StartDate).slice(0, 10) === TEST_START &&
        fmt(after.DueDate).slice(0, 10) === TEST_DUE;
      console.log(`  ${changed ? '✅ PERSISTED' : '❌ NO-OP   '}  [${label}]`);
      console.log(`     after  StartDate=${fmt(after.StartDate)}  DueDate=${fmt(after.DueDate)}`);
    } catch (err) {
      console.log(`  ⚠️  ERROR    [${label}]: ${(err as Error).message}`);
    } finally {
      await tx.rollback(); // leave the DB untouched
    }
  }

  console.log('── Binding tests (each rolled back) ───────────────────────────');

  // Test A — exactly how apps/api roadmap.repository.ts binds: STRING values.
  await trial('A: sql.Date/DateTime2 + STRING ("2029-09-09")', (req) => {
    req.input('StartDate', sql.Date,      TEST_START);
    req.input('DueDate',   sql.DateTime2, TEST_DUE);
  });

  // Test B — JS Date objects instead of strings.
  await trial('B: sql.Date/DateTime2 + JS Date object', (req) => {
    const [sy, sm, sd] = TEST_START.split('-').map(Number);
    const [dy, dm, dd] = TEST_DUE.split('-').map(Number);
    req.input('StartDate', sql.Date,      new Date(sy!, sm! - 1, sd!));
    req.input('DueDate',   sql.DateTime2, new Date(dy!, dm! - 1, dd!));
  });

  // Test C — control: raw inline UPDATE (no proc) to prove the column writes.
  {
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      await new sql.Request(tx).query(
        `UPDATE Tasks SET StartDate='${TEST_START}', DueDate='${TEST_DUE}' WHERE Id='${task.Id}'`,
      );
      const after = await readDates(new sql.Request(tx), task.Id);
      const changed =
        fmt(after.StartDate).slice(0, 10) === TEST_START &&
        fmt(after.DueDate).slice(0, 10) === TEST_DUE;
      console.log(`  ${changed ? '✅ PERSISTED' : '❌ NO-OP   '}  [C: raw inline UPDATE control]`);
      console.log(`     after  StartDate=${fmt(after.StartDate)}  DueDate=${fmt(after.DueDate)}`);
    } finally {
      await tx.rollback();
    }
  }

  console.log('───────────────────────────────────────────────────────────────');
  console.log('\nAll writes were rolled back — database is unchanged.');
  await pool.close();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
