/**
 * Redis cache service — wraps ioredis with typed get/set/del helpers.
 *
 * All public functions are safe to call even when Redis is unavailable:
 * they log a warning and return null / do nothing, so the application
 * gracefully degrades to hitting the database every request.
 */

import { getRedis } from './redis.js';
import { subLogger } from './logger.js';

const log = subLogger('cache');

// ── TTL presets (seconds) ───────────────────────────────────────────────────

export const TTL = {
  /** Very short — burst traffic deduplication (5 s) */
  BURST:   5,
  /** Short — frequently-updated lists (30 s) */
  SHORT:   30,
  /** Medium — semi-static data: project / sprint lists (2 min) */
  MEDIUM:  120,
  /** Long — slow-changing data: workspace members, labels (5 min) */
  LONG:    300,
  /** Very long — rarely-changing: versions, components (15 min) */
  XLONG:   900,
} as const;

// ── Key builder helpers ─────────────────────────────────────────────────────

export const CacheKey = {
  workspaceMembers: (wsId: string)            => `ws:${wsId}:members`,
  workspaceProjects:(wsId: string)            => `ws:${wsId}:projects`,
  project:          (id: string)              => `project:${id}`,
  sprintList:       (projectId: string)       => `project:${projectId}:sprints`,
  activeSprint:     (projectId: string)       => `project:${projectId}:sprint:active`,
  taskList:         (projectId: string, page: number) => `project:${projectId}:tasks:${page}`,
  task:             (id: string)              => `task:${id}`,
  labels:           (projectId: string)       => `project:${projectId}:labels`,
  components:       (projectId: string)       => `project:${projectId}:components`,
  versions:         (projectId: string)       => `project:${projectId}:versions`,
  epics:            (projectId: string)       => `project:${projectId}:epics`,
  adminStats:       ()                        => 'admin:stats',
  notifications:    (userId: string, page: number) => `user:${userId}:notifs:${page}`,
} as const;

// ── Core helpers ────────────────────────────────────────────────────────────

/**
 * Get a cached JSON value. Returns null on miss or Redis error.
 */
export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const raw = await getRedis().get(key);
    if (raw === null) return null;
    return JSON.parse(raw) as T;
  } catch (err) {
    log.warn({ err: (err as Error).message }, 'get error');
    return null;
  }
}

/**
 * Store a JSON value with a TTL. Silently swallows Redis errors.
 */
export async function cacheSet(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  try {
    await getRedis().set(key, JSON.stringify(value), 'EX', ttlSeconds);
  } catch (err) {
    log.warn({ err: (err as Error).message }, 'set error');
  }
}

/**
 * Delete one or more keys. Silently swallows Redis errors.
 */
export async function cacheDel(...keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  try {
    await getRedis().del(...keys);
  } catch (err) {
    log.warn({ err: (err as Error).message }, 'del error');
  }
}

/**
 * Delete all keys matching a glob pattern.
 * Uses SCAN to avoid blocking Redis with large key-spaces.
 */
export async function cacheDelPattern(pattern: string): Promise<void> {
  const redis = getRedis();
  try {
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
      cursor = next;
      if (keys.length > 0) await redis.del(...keys);
    } while (cursor !== '0');
  } catch (err) {
    log.warn({ err: (err as Error).message }, 'delPattern error');
  }
}

/**
 * Ping Redis — returns true if reachable, false otherwise.
 * Used by the health endpoint.
 */
export async function cachePing(): Promise<boolean> {
  try {
    const result = await getRedis().ping();
    return result === 'PONG';
  } catch {
    return false;
  }
}

/**
 * Cache-aside helper: returns cached data if present, otherwise calls
 * `loader()`, caches its result, and returns it.
 *
 * Usage:
 *   const projects = await withCache(CacheKey.workspaceProjects(wsId), TTL.MEDIUM, () =>
 *     projectRepository.listByWorkspace(wsId)
 *   );
 */
export async function withCache<T>(
  key:        string,
  ttlSeconds: number,
  loader:     () => Promise<T>,
): Promise<T> {
  const cached = await cacheGet<T>(key);
  if (cached !== null) return cached;

  const fresh = await loader();
  // Don't await — fire-and-forget the write so the request isn't delayed
  cacheSet(key, fresh, ttlSeconds).catch(() => {});
  return fresh;
}
