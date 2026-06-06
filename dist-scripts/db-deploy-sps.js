"use strict";
/**
 * db-deploy-sps.ts — Idempotent stored-procedure deployer.
 *
 * Usage:
 *   npx tsx scripts/db-deploy-sps.ts
 *   # or via npm script:
 *   npm run db:deploy-sps
 *
 * Reads every *.sql file in infra/sql/procedures/ and executes it against the
 * configured database.  Because every SP file uses CREATE OR ALTER PROCEDURE,
 * the operation is fully idempotent — safe to run on every deployment.
 *
 * Batches are separated on GO statements (T-SQL batch separator).
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const mssql_1 = __importDefault(require("mssql"));
// ── Connection config ─────────────────────────────────────────────────────────
const config = {
    server: process.env.DB_SERVER || 'localhost',
    port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 1433,
    user: process.env.DB_USER || 'sa',
    password: process.env.DB_PASSWORD || 'YourStrong@Passw0rd',
    database: process.env.DB_NAME || 'ProjectFlow',
    options: {
        encrypt: process.env.DB_ENCRYPT === 'true',
        trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE !== 'false',
    },
    pool: { max: 3, min: 1, idleTimeoutMillis: 10000 },
    requestTimeout: 30_000,
};
// ── Paths ────────────────────────────────────────────────────────────────────
const PROCEDURES_DIR = path_1.default.resolve(path_1.default.dirname(decodeURIComponent(new URL(import.meta.url).pathname.replace(/^\/([a-zA-Z]:)/, '$1'))), '../infra/sql/procedures');
// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
    console.log('ProjectFlow — Stored Procedure Deployer');
    console.log(`Procedures dir: ${PROCEDURES_DIR}\n`);
    const pool = await new mssql_1.default.ConnectionPool(config).connect();
    console.log(`Connected to ${config.server}/${config.database}\n`);
    const entries = await fs_1.promises.readdir(PROCEDURES_DIR);
    const sqlFiles = entries.filter((f) => f.endsWith('.sql')).sort();
    let ok = 0;
    let failed = 0;
    for (const file of sqlFiles) {
        const filePath = path_1.default.join(PROCEDURES_DIR, file);
        const content = await fs_1.promises.readFile(filePath, 'utf8');
        // Split on GO statements
        const batches = content
            .split(/^\s*GO\s*$/im)
            .map((b) => b.trim())
            .filter(Boolean);
        process.stdout.write(`  → ${file} ... `);
        try {
            for (const batch of batches) {
                await pool.request().query(batch);
            }
            console.log('OK');
            ok++;
        }
        catch (err) {
            console.log('FAILED');
            console.error(`    Error: ${err.message}`);
            failed++;
            // Continue to deploy remaining SPs rather than aborting
        }
    }
    await pool.close();
    console.log(`\nDone. ${ok} deployed, ${failed} failed.`);
    if (failed > 0)
        process.exit(1);
}
main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
});
