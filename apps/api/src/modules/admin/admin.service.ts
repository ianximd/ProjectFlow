import { adminRepository, type CreateAuditInput, type AuditListFilters } from './admin.repository.js';

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
};
