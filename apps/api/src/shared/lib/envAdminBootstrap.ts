import { roleService } from '../../modules/roles/role.service.js';

/**
 * Idempotently promote every user listed in the legacy ADMIN_USER_IDS env var
 * to the `super-admin` system role.
 *
 * Run once at API server startup. Safe to re-run — the underlying sproc inserts
 * only if the assignment doesn't already exist.
 *
 * The env var stays as a runtime fallback (see permissions.middleware.ts) until
 * the next release; this hook closes the loop so the DB matches intent.
 */
export async function ensureEnvAdminsPromoted(): Promise<void> {
  const ids = (process.env.ADMIN_USER_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (ids.length === 0) return;

  let promoted = 0;
  for (const userId of ids) {
    try {
      await roleService.assignRoleBySlug({
        userId,
        roleSlug: 'super-admin',
        workspaceId: null,
      });
      promoted += 1;
    } catch (err) {
      // Most likely the user id from the env var doesn't exist in the DB.
      // Log and keep going — don't block server startup over one bad entry.
      console.warn(
        `[env-admin-bootstrap] Failed to promote user '${userId}':`,
        (err as Error).message,
      );
    }
  }

  if (promoted > 0) {
    console.log(`[env-admin-bootstrap] Ensured super-admin role on ${promoted} env-listed user(s).`);
  }
}
