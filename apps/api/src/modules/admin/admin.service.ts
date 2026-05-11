import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { adminRepository, type CreateAuditInput, type AuditListFilters } from './admin.repository.js';

const BCRYPT_ROUNDS = 12;

// 16 bytes → 22 url-safe chars. Long enough that an admin can read it out
// loud once without it being guessable, short enough to type if needed.
function generateTempPassword(): string {
  return randomBytes(16).toString('base64url');
}

export const adminService = {
  // ── Audit log ──────────────────────────────────────────────────────────────

  /**
   * Fire-and-forget audit logging. Never throws — failures are silently
   * discarded so the audit system never impacts the primary request path.
   */
  log(input: CreateAuditInput): void {
    adminRepository.createAuditEntry(input).catch(() => {});
  },

  listAuditLog: (filters: AuditListFilters) =>
    adminRepository.listAuditLog(filters),

  // ── Admin dashboard ────────────────────────────────────────────────────────

  getStats: () => adminRepository.getStats(),

  listUsers: (search?: string, page?: number, pageSize?: number) =>
    adminRepository.listUsers(search, page, pageSize),

  listWorkspaces: (page?: number, pageSize?: number) =>
    adminRepository.listWorkspaces(page, pageSize),

  toggleUserActive: (userId: string, suspend: boolean) =>
    adminRepository.toggleUserActive(userId, suspend),

  // ── Admin user CRUD + recovery ────────────────────────────────────────────

  async createUser(email: string, name: string, password: string | undefined, isEmailVerified: boolean) {
    // Generate one if the admin didn't supply a password — returned plaintext
    // ONCE in the response so they can hand it to the user out-of-band.
    const plain = password ?? generateTempPassword();
    const hash  = await bcrypt.hash(plain, BCRYPT_ROUNDS);
    const user  = await adminRepository.createUser(email, name, hash, isEmailVerified);
    return { user, tempPassword: password ? null : plain };
  },

  updateUser: (id: string, fields: { email?: string; name?: string }) =>
    adminRepository.updateUser(id, fields),

  hardDeleteUser: (id: string) => adminRepository.hardDeleteUser(id),

  async resetPassword(id: string) {
    const plain = generateTempPassword();
    const hash  = await bcrypt.hash(plain, BCRYPT_ROUNDS);
    await adminRepository.setPassword(id, hash);
    return plain;
  },

  disableMfa: (id: string) => adminRepository.disableMfa(id),
  unlockUser: (id: string) => adminRepository.unlockUser(id),

  // Sequential rather than parallel: keeps the audit log ordered and avoids
  // hammering the SP layer with N concurrent transactions.
  async bulkSuspend(userIds: string[], suspend: boolean) {
    const results: Array<{ id: string; ok: boolean; error?: string }> = [];
    for (const id of userIds) {
      try {
        const u = await adminRepository.toggleUserActive(id, suspend);
        results.push({ id, ok: u !== null });
      } catch (err: any) {
        results.push({ id, ok: false, error: err?.message ?? 'failed' });
      }
    }
    return results;
  },
};
