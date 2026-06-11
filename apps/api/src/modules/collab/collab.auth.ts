import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../../shared/lib/jwtSecret.js';
import { accessService } from '../access/access.service.js';
import { CollabRepository } from './collab.repository.js';
import { docNameToTarget } from './yjsPersistence.js';
import { whiteboardService } from '../whiteboards/whiteboard.service.js';

const repo = new CollabRepository();

export interface CollabAuthContext {
  userId: string;
  pageId: string;
  workspaceId: string;
}

/**
 * Fail-closed collab auth. Verifies the JWT, decodes the document name,
 * resolves the owning hierarchy scope (doc-page via usp_Doc_ResolveScopeNode;
 * whiteboard via whiteboardService.getById), and requires EDIT on it.
 * Throws on any failure (Hocuspocus rejects the connection).
 *
 * Both doc-page and whiteboard kinds are now fully resolved (7b wiring).
 */
export async function authenticateCollab(token: string, documentName: string): Promise<CollabAuthContext> {
  const target = docNameToTarget(documentName);
  if (!target) throw new Error('Invalid collaboration document name');

  let userId: string;
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { userId?: string };
    userId = payload.userId ?? '';
  } catch {
    throw new Error('Invalid or expired token');
  }
  if (!userId) throw new Error('Token missing userId');

  // Resolve the owning hierarchy scope per kind, then require EDIT on it.
  let scope: { scopeType: 'SPACE' | 'FOLDER' | 'LIST'; scopeId: string; workspaceId: string } | null;
  if (target.kind === 'doc-page') {
    const node = await repo.resolveScopeNode(target.id);
    scope = node
      ? { scopeType: node.scopeType as 'SPACE' | 'FOLDER' | 'LIST', scopeId: node.scopeId, workspaceId: node.workspaceId }
      : null;
  } else if (target.kind === 'whiteboard') {
    const wb = await whiteboardService.getById(target.id);
    scope = wb
      ? { scopeType: wb.scopeType, scopeId: wb.scopeId, workspaceId: wb.workspaceId }
      : null;
  } else {
    throw new Error(`Unsupported collab kind: ${target.kind}`);
  }
  if (!scope) throw new Error('Document not found');           // 404 fail-closed

  const allowed = await accessService.can(userId, scope.scopeType, scope.scopeId, 'EDIT');
  if (!allowed) throw new Error('Forbidden');                  // cross-tenant fail-closed

  return { userId, pageId: target.id, workspaceId: scope.workspaceId };
}
