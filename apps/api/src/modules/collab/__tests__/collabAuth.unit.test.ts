import { describe, it, expect, vi, beforeEach } from 'vitest';
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../../../shared/lib/jwtSecret.js';

const resolveScopeNode = vi.fn();
const can = vi.fn();
const getById = vi.fn();
vi.mock('../collab.repository.js', () => ({ CollabRepository: class { resolveScopeNode = resolveScopeNode; } }));
vi.mock('../../access/access.service.js', () => ({ accessService: { can } }));
vi.mock('../../whiteboards/whiteboard.service.js', () => ({ whiteboardService: { getById } }));

const { authenticateCollab } = await import('../collab.auth.js');

const sign = (uid: string) => jwt.sign({ userId: uid, email: 'u@x.test' }, JWT_SECRET);

beforeEach(() => { resolveScopeNode.mockReset(); can.mockReset(); getById.mockReset(); });

describe('authenticateCollab', () => {
  it('rejects a malformed document name', async () => {
    await expect(authenticateCollab(sign('u1'), 'garbage')).rejects.toThrow();
  });
  it('rejects an invalid JWT', async () => {
    await expect(authenticateCollab('not-a-jwt', 'doc-page:p1')).rejects.toThrow();
  });
  it('rejects when the page/scope cannot be resolved (404 fail-closed)', async () => {
    resolveScopeNode.mockResolvedValue(null);
    await expect(authenticateCollab(sign('u1'), 'doc-page:p1')).rejects.toThrow();
  });
  it('rejects when the user lacks EDIT on the scope node', async () => {
    resolveScopeNode.mockResolvedValue({ scopeType: 'SPACE', scopeId: 's1', workspaceId: 'w1' });
    can.mockResolvedValue(false);
    await expect(authenticateCollab(sign('u1'), 'doc-page:p1')).rejects.toThrow();
  });
  it('returns the user + level on success', async () => {
    resolveScopeNode.mockResolvedValue({ scopeType: 'SPACE', scopeId: 's1', workspaceId: 'w1' });
    can.mockResolvedValue(true);
    const ctx = await authenticateCollab(sign('u9'), 'doc-page:p1');
    expect(ctx.userId).toBe('u9');
    expect(can).toHaveBeenCalledWith('u9', 'SPACE', 's1', 'EDIT');
  });
});

describe('authenticateCollab — whiteboard', () => {
  const fakeBoard = { id: 'wb1', scopeType: 'SPACE' as const, scopeId: 's1', workspaceId: 'w1' };

  it('success: resolves ctx and enforces EDIT on the board scope', async () => {
    getById.mockResolvedValue(fakeBoard);
    can.mockResolvedValue(true);
    const ctx = await authenticateCollab(sign('u9'), 'whiteboard:wb1');
    expect(ctx).toEqual({ userId: 'u9', pageId: 'wb1', workspaceId: 'w1' });
    expect(getById).toHaveBeenCalledWith('wb1');
    expect(can).toHaveBeenCalledWith('u9', 'SPACE', 's1', 'EDIT');
  });

  it('not found: rejects fail-closed when getById returns null', async () => {
    getById.mockResolvedValue(null);
    await expect(authenticateCollab(sign('u9'), 'whiteboard:wb1')).rejects.toThrow(/not found/i);
  });

  it('forbidden: rejects fail-closed when user lacks EDIT on the scope', async () => {
    getById.mockResolvedValue(fakeBoard);
    can.mockResolvedValue(false);
    await expect(authenticateCollab(sign('u9'), 'whiteboard:wb1')).rejects.toThrow(/forbidden/i);
  });

  it('invalid token: rejects before reaching whiteboard lookup', async () => {
    await expect(authenticateCollab('not-a-jwt', 'whiteboard:wb1')).rejects.toThrow();
    expect(getById).not.toHaveBeenCalled();
  });
});
