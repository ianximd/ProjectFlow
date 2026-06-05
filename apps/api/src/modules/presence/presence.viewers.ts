export const PRESENCE_TTL_MS = 30_000;

export interface PresenceUser {
  userId:    string;
  name:      string;
  avatarUrl: string | null;
  typing:    boolean;
  lastSeen:  number;
}

/**
 * Given a Redis hash (field=userId → JSON), return active viewers
 * (seen within the TTL window) plus the stale fields to evict.
 */
export function computeActiveViewers(
  raw:   Record<string, string>,
  nowMs: number,
): { viewers: PresenceUser[]; stale: string[] } {
  const viewers: PresenceUser[] = [];
  const stale:   string[]       = [];

  for (const [userId, json] of Object.entries(raw)) {
    let parsed: any;
    try {
      parsed = JSON.parse(json);
    } catch {
      stale.push(userId);
      continue;
    }

    const lastSeen = Number(parsed?.lastSeen ?? 0);
    if (!lastSeen || nowMs - lastSeen > PRESENCE_TTL_MS) {
      stale.push(userId);
      continue;
    }

    viewers.push({
      userId,
      name:      String(parsed.name ?? ''),
      avatarUrl: parsed.avatarUrl ?? null,
      typing:    Boolean(parsed.typing),
      lastSeen,
    });
  }

  viewers.sort((a, b) => a.userId.localeCompare(b.userId));
  return { viewers, stale };
}
