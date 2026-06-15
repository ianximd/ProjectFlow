import type { HierarchyNodeType } from '@projectflow/types';

export const WORKSPACE_GUEST_ROLE          = 'workspace-guest' as const;
export const WORKSPACE_LIMITED_MEMBER_ROLE = 'workspace-limited-member' as const;
export type GuestRoleSlug = typeof WORKSPACE_GUEST_ROLE | typeof WORKSPACE_LIMITED_MEMBER_ROLE;

/** True when the email's domain matches the workspace's verified org domain. */
export function isOrgEmail(email: string, verifiedDomain: string | null): boolean {
  if (!verifiedDomain) return false;
  const at = email.lastIndexOf('@');
  if (at < 0) return false;
  return email.slice(at + 1).trim().toLowerCase() === verifiedDomain.trim().toLowerCase();
}

/** Org-email -> limited member; external -> guest. (Spec promotion rule.) */
export function resolveInviteRole(email: string, verifiedDomain: string | null): GuestRoleSlug {
  return isOrgEmail(email, verifiedDomain) ? WORKSPACE_LIMITED_MEMBER_ROLE : WORKSPACE_GUEST_ROLE;
}

export class GuestObjectScopeError extends Error {
  readonly code = 'GUEST_SPACE_SCOPE_FORBIDDEN';
}

/** A GUEST may not be granted Space scope (only Folder/List/task objects). A
 *  LIMITED MEMBER may. */
export function assertGuestObjectAllowed(role: GuestRoleSlug, objectType: HierarchyNodeType): void {
  if (role === WORKSPACE_GUEST_ROLE && objectType === 'SPACE') {
    throw new GuestObjectScopeError('A guest cannot be added at Space scope — grant a Folder or List instead.');
  }
}

/** Documents the resolver invariant in TS: a guest/limited member contributes
 *  NO membership floor regardless of their underlying membership row. */
export function guestFloor(_isGuestMember: boolean): null { return null; }
