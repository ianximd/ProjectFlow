/**
 * Snapshot registry for the audit middleware (Phase 6 — W43 field-level audit).
 *
 * For each audited resource (Task, Project, Sprint, ...) we register a
 * fetcher that returns a JSON-safe snapshot of one row by id. The audit
 * middleware uses these to capture the BEFORE state (pre-handler) and
 * AFTER state (post-handler) of an UPDATE/DELETE, then writes only the
 * fields that actually changed into `AuditLog.OldValues` / `NewValues`.
 *
 * Why a registry, not direct repo imports in the middleware:
 *   - Keeps the middleware decoupled from every domain module — no
 *     import graph going through `audit.middleware.ts → tasks → audit`
 *     and back.
 *   - Makes the registration explicit and testable: bootstrap calls
 *     `registerAuditSnapshots()` from `server.ts` (and integration tests
 *     call it too).
 *   - Resources without a registered fetcher just skip the diff —
 *     auditing still records WHO/WHAT/WHEN, just without before/after
 *     values. Same fallback as before this phase.
 */

export type SnapshotRow = Record<string, unknown>;
export type SnapshotFetcher = (id: string) => Promise<SnapshotRow | null>;

const registry = new Map<string, SnapshotFetcher>();

/**
 * Register or replace the snapshot fetcher for a resource. Resource keys
 * match the strings produced by `pathToResource()` in audit.middleware.ts
 * (e.g. 'Task', 'Project', 'Workspace').
 */
export function registerSnapshot(resource: string, fetcher: SnapshotFetcher): void {
  registry.set(resource, fetcher);
}

export function getSnapshotFetcher(resource: string): SnapshotFetcher | undefined {
  return registry.get(resource);
}

/**
 * Test-only — reset the registry between tests that wire their own
 * fetchers. Not exported via index; tests import this path directly.
 */
export function _resetSnapshotsForTest(): void {
  registry.clear();
}

/**
 * Compute the field-level diff between two snapshots. Returns `null` for
 * either side when there are no changes worth recording.
 *
 *   - Only keys present in `after` (and `before`) are considered.
 *   - Equality is shallow (===) for primitives, JSON-string for
 *     objects/arrays. Two unequal arrays-of-strings will appear in the
 *     diff as a whole; we don't deep-diff into them.
 *   - Date objects are compared by ISO string so a no-op SP that touches
 *     UpdatedAt doesn't generate a noisy diff. (UpdatedAt and similar
 *     SQL-server-managed timestamps are excluded explicitly below.)
 *
 * Both returned objects only contain the changed keys, so audit-log
 * consumers see exactly what mutated.
 */
const IGNORED_KEYS = new Set([
  'UpdatedAt', 'updatedAt',
  // These exist on a few entities but aren't user-meaningful for diffs.
  'updated_at',
]);

export function computeChangedFields(
  before: SnapshotRow | null,
  after:  SnapshotRow | null,
): { oldValues: SnapshotRow | null; newValues: SnapshotRow | null } {
  if (before === null && after === null) {
    return { oldValues: null, newValues: null };
  }
  if (before === null) {
    // CREATE — no before-state. We still surface the new row as NewValues
    // so audit consumers can see what was created when the route actually
    // gave us a way to fetch the new id (POST routes today don't pass
    // resourceId, so this branch is reserved for future use).
    return { oldValues: null, newValues: after };
  }
  if (after === null) {
    // DELETE — no after-state. The full before-snapshot is the most
    // useful "what got deleted" record.
    return { oldValues: before, newValues: null };
  }

  const oldValues: SnapshotRow = {};
  const newValues: SnapshotRow = {};
  const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);

  for (const key of allKeys) {
    if (IGNORED_KEYS.has(key)) continue;
    const a = before[key];
    const b = after[key];
    if (equalish(a, b)) continue;
    oldValues[key] = a ?? null;
    newValues[key] = b ?? null;
  }

  if (Object.keys(newValues).length === 0) {
    return { oldValues: null, newValues: null };
  }
  return { oldValues, newValues };
}

function equalish(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null && b == null) return true;
  if (a instanceof Date && b instanceof Date) {
    return a.getTime() === b.getTime();
  }
  if (typeof a === 'object' && typeof b === 'object' && a !== null && b !== null) {
    try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; }
  }
  return false;
}
