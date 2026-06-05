import { getRedis } from '../../shared/lib/redis.js';
import { withCache, TTL } from '../../shared/lib/cache.js';
import { execSpOne } from '../../shared/lib/sqlClient.js';
import sql from 'mssql';
import { computeActiveViewers, type PresenceUser } from './presence.viewers.js';

const key = (taskId: string) => `presence:task:${taskId}`;
const KEY_TTL_SEC = 60; // whole-key expiry safety net (> PRESENCE_TTL_MS / 1000)

async function userDisplay(userId: string): Promise<{ name: string; avatarUrl: string | null }> {
  return withCache(`user:${userId}:display`, TTL.LONG, async () => {
    const rows = await execSpOne<any>('usp_User_GetDisplay', [
      { name: 'Id', type: sql.UniqueIdentifier, value: userId },
    ]);
    return { name: rows[0]?.Name ?? '', avatarUrl: rows[0]?.AvatarUrl ?? null };
  });
}

export async function heartbeat(
  taskId: string,
  userId: string,
  typing: boolean,
  nowMs:  number = Date.now(),
): Promise<PresenceUser[]> {
  const redis = getRedis();
  const { name, avatarUrl } = await userDisplay(userId);
  const field = JSON.stringify({ name, avatarUrl, typing, lastSeen: nowMs });
  try {
    await redis.hset(key(taskId), userId, field);
    await redis.expire(key(taskId), KEY_TTL_SEC);
  } catch { /* degrade */ }
  return snapshot(taskId, nowMs);
}

export async function snapshot(
  taskId: string,
  nowMs:  number = Date.now(),
): Promise<PresenceUser[]> {
  const redis = getRedis();
  let raw: Record<string, string> = {};
  try {
    raw = (await redis.hgetall(key(taskId))) ?? {};
  } catch {
    return [];
  }
  const { viewers, stale } = computeActiveViewers(raw, nowMs);
  if (stale.length) {
    try { await redis.hdel(key(taskId), ...stale); } catch { /* ignore */ }
  }
  return viewers;
}

export async function leave(
  taskId: string,
  userId: string,
  nowMs:  number = Date.now(),
): Promise<PresenceUser[]> {
  try { await getRedis().hdel(key(taskId), userId); } catch { /* ignore */ }
  return snapshot(taskId, nowMs);
}

export const presenceService = { heartbeat, snapshot, leave };
