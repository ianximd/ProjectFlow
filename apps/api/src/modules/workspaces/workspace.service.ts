import { WorkspaceRepository } from './workspace.repository.js';

const repo = new WorkspaceRepository();

export const workspaceService = {
  create: (name: string, slug: string, ownerId: string) => repo.create(name, slug, ownerId),
  list:   (userId: string) => repo.list(userId),
  getById:(id: string) => repo.getById(id),
  addMember: (workspaceId: string, userId: string, role?: string) => repo.addMember(workspaceId, userId, role),
  update: (id: string, fields: { name?: string; slug?: string; avatarUrl?: string | null; verifiedDomain?: string | null }) => repo.update(id, fields),
  delete: (id: string) => repo.softDelete(id),
  listMembers:    (workspaceId: string) => repo.listMembers(workspaceId),
  addMemberByEmail: (workspaceId: string, email: string, role?: string) =>
    repo.addMemberByEmail(workspaceId, email, role),
  removeMember:   (workspaceId: string, userId: string) =>
    repo.removeMember(workspaceId, userId),
  setMemberRole:  (workspaceId: string, userId: string, role: string) =>
    repo.setMemberRole(workspaceId, userId, role),
};
