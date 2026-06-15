import { AdminRepository } from '../admin/admin.repository.js';

const adminRepo = new AdminRepository();

export interface AccessAuditInput {
  workspaceId: string | null;
  userId: string;
  userEmail?: string | null;
  action: string;
  resource: string;
  resourceId: string | null;
  oldValues?: unknown;
  newValues?: unknown;
}

/** Best-effort audit write — never block the mutation it records. */
export async function writeAccessAudit(input: AccessAuditInput): Promise<void> {
  try {
    await adminRepo.createAuditEntry({
      workspaceId: input.workspaceId ?? undefined,
      userId: input.userId,
      userEmail: input.userEmail ?? undefined,
      action: input.action,
      resource: input.resource,
      resourceId: input.resourceId ?? undefined,
      oldValues: (input.oldValues ?? undefined) as Record<string, unknown> | undefined,
      newValues: (input.newValues ?? undefined) as Record<string, unknown> | undefined,
    });
  } catch { /* auditing must not fail the operation */ }
}
