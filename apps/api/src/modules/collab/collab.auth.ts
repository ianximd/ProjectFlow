import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../../shared/lib/jwtSecret.js';
import { accessService } from '../access/access.service.js';
import { CollabRepository } from './collab.repository.js';
import { docNameToTarget } from './yjsPersistence.js';

const repo = new CollabRepository();

export interface CollabAuthContext {
  userId: string;
  pageId: string;
  workspaceId: string;
}

/**
 * Fail-closed collab auth. Verifies the JWT, decodes the document name,
 * resolves the doc-page's owning hierarchy node, and requires EDIT on it.
 * Throws on any failure (Hocuspocus rejects the connection).
 *
 * Whiteboard targets are accepted at the name level (the server is generic
 * for 7b) but rejected here until 7b wires their scope resolution.
 */
export async function authenticateCollab(token: string, documentName: string): Promise<CollabAuthContext> {
  const target = docNameToTarget(documentName);
  if (!target) throw new Error('Invalid collaboration document name');
  if (target.kind !== 'doc-page') throw new Error(`Unsupported collab kind in 7a: ${target.kind}`);

  let userId: string;
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { userId?: string };
    userId = payload.userId ?? '';
  } catch {
    throw new Error('Invalid or expired token');
  }
  if (!userId) throw new Error('Token missing userId');

  const node = await repo.resolveScopeNode(target.id);
  if (!node) throw new Error('Document not found');           // 404 fail-closed

  const allowed = await accessService.can(userId, node.scopeType, node.scopeId, 'EDIT');
  if (!allowed) throw new Error('Forbidden');

  return { userId, pageId: target.id, workspaceId: node.workspaceId };
}
