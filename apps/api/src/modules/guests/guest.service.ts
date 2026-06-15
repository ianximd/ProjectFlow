import { randomBytes } from 'node:crypto';
import { GuestRepository } from './guest.repository.js';
import { WorkspaceRepository } from '../workspaces/workspace.repository.js';
import {
  resolveInviteRole, assertGuestObjectAllowed, isOrgEmail,
  WORKSPACE_GUEST_ROLE, WORKSPACE_LIMITED_MEMBER_ROLE, type GuestRoleSlug,
} from './guest.pure.js';
import type { GuestInvite, InviteGuestInput, GuestListResult } from '@projectflow/types';

export class GuestService {
  constructor(
    private repo = new GuestRepository(),
    private workspaceRepo = new WorkspaceRepository(),
  ) {}

  /** Invite a guest to a specific object at a level. Org-email -> limited member
   *  (promoted); a guest may NOT be granted Space scope. */
  async invite(input: InviteGuestInput, invitedBy: string): Promise<{ invite: GuestInvite; role: GuestRoleSlug }> {
    const verifiedDomain = await this.workspaceRepo.getVerifiedDomain(input.workspaceId); // string | null
    const role = resolveInviteRole(input.email, verifiedDomain);
    assertGuestObjectAllowed(role, input.objectType);                 // throws GuestObjectScopeError on guest@SPACE
    const token = randomBytes(32).toString('base64url'); // 43 chars, 256 bits entropy, fits NVARCHAR(64)
    const invite = await this.repo.createInvite({
      workspaceId: input.workspaceId, email: input.email.toLowerCase(),
      objectType: input.objectType, objectId: input.objectId, level: input.level,
      token, invitedBy, expiresAt: input.expiresAt ?? null,
    });
    return { invite, role };
  }

  /** Accept an invite: the authed user's email must match the invite email
   *  (enforced in the route before this call); the membership row + grant are
   *  created atomically in usp_GuestInvite_Accept. */
  async accept(token: string, accepterUserId: string, accepterEmail: string, verifiedDomain: string | null) {
    const role: GuestRoleSlug = isOrgEmail(accepterEmail, verifiedDomain)
      ? WORKSPACE_LIMITED_MEMBER_ROLE : WORKSPACE_GUEST_ROLE;
    return this.repo.acceptInvite(token, accepterUserId, role);
  }

  list(workspaceId: string): Promise<GuestListResult> {
    return this.repo.listGuests(workspaceId);
  }

  revoke(workspaceId: string, opts: { userId?: string; inviteId?: string }): Promise<void> {
    return this.repo.revokeGuest(workspaceId, opts);
  }
}

export const guestService = new GuestService();
