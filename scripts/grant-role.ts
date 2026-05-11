/**
 * grant-role.ts — Bootstrap utility: grant a role slug to a user account.
 *
 * Usage:
 *   npx tsx scripts/grant-role.ts <email> <role-slug> [workspace-id]
 *
 * Examples:
 *   # Grant system-wide super-admin to a user
 *   npx tsx scripts/grant-role.ts admin@projectflow.local super-admin
 *
 *   # Grant a workspace-scoped role
 *   npx tsx scripts/grant-role.ts user@x.com workspace-admin <workspace-uuid>
 *
 * Intended for first-account bootstrap. After at least one super-admin exists,
 * subsequent role assignments should go through the /admin → Roles UI.
 *
 * Connection env vars match the API (DB_SERVER / DB_USER / DB_PASSWORD / DB_NAME
 * / DB_ENCRYPT / DB_TRUST_SERVER_CERTIFICATE).
 */

import sql from 'mssql';

const config: sql.config = {
  server:   process.env.DB_SERVER   || 'localhost',
  user:     process.env.DB_USER     || 'sa',
  password: process.env.DB_PASSWORD || 'YourStrong@Passw0rd',
  database: process.env.DB_NAME     || 'ProjectFlow',
  options: {
    encrypt:                process.env.DB_ENCRYPT === 'true',
    trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE !== 'false',
  },
  pool: { max: 2, min: 1, idleTimeoutMillis: 5000 },
  requestTimeout: 30_000,
};

async function main() {
  const [email, roleSlug, workspaceId] = process.argv.slice(2);

  if (!email || !roleSlug) {
    console.error('Usage: npx tsx scripts/grant-role.ts <email> <role-slug> [workspace-id]');
    process.exit(2);
  }

  const pool = await new sql.ConnectionPool(config).connect();
  console.log(`Connected to ${config.server}/${config.database}`);

  // Look up the user. Refuse to grant against soft-deleted accounts so the
  // operator notices if they typed the wrong email.
  const userResult = await pool.request()
    .input('Email', sql.NVarChar(255), email)
    .query('SELECT Id, Name, DeletedAt FROM dbo.Users WHERE Email = @Email');

  const user = userResult.recordset[0];
  if (!user) {
    console.error(`No user with email ${email}.`);
    await pool.close();
    process.exit(1);
  }
  if (user.DeletedAt) {
    console.error(`User ${email} is suspended (DeletedAt set). Restore them first.`);
    await pool.close();
    process.exit(1);
  }

  console.log(`Found user: ${user.Name} (${user.Id})`);
  console.log(`Granting role: ${roleSlug}${workspaceId ? ` (workspace: ${workspaceId})` : ' (system-scoped)'}`);

  try {
    await pool.request()
      .input('UserId',      sql.UniqueIdentifier, user.Id)
      .input('RoleSlug',    sql.NVarChar(100),    roleSlug)
      .input('WorkspaceId', sql.UniqueIdentifier, workspaceId ?? null)
      .input('AssignedBy',  sql.UniqueIdentifier, null)
      .execute('dbo.usp_UserRole_AssignBySlug');
    console.log('Granted.');
  } catch (err: any) {
    console.error(`Grant failed: ${err.message ?? err}`);
    await pool.close();
    process.exit(1);
  }

  await pool.close();
}

main().catch(async (err) => {
  console.error(err);
  process.exit(1);
});
