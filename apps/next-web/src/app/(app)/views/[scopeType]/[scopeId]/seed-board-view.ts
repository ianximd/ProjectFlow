import 'server-only';
import type { SavedView, ViewConfig, ViewScopeType } from '@projectflow/types';
import { createSavedView } from '@/server/actions/views';

// ── Seed-on-demand: default Board view ──────────────────────────────────────────
// The views engine renders whichever saved view is active. A scope may not yet
// have a `board`-type view, so the Board tab would be unavailable. When the caller
// explicitly requests a board (?view=board on the views route) and the scope has
// no board-type view, we create a minimal shared+default one so the surface can
// render it.
//
// IDEMPOTENT: if ANY board-type view already exists for the scope we do nothing
// and return that view's id, so refreshes / concurrent loads never create
// duplicates. The empty filter config matches getViewTasks' "all tasks in scope"
// behaviour, which is the board's parity baseline against legacy getTasks.

/** Default board ViewConfig: empty filter, position-asc sort (engine defaults). */
function defaultBoardConfig(): ViewConfig {
  return {
    filter: { conjunction: 'AND', rules: [] },
    sort: [{ field: { kind: 'builtin', key: 'position' }, dir: 'ASC' }],
  };
}

/**
 * Ensure a board-type saved view exists for the scope, creating one only when
 * none is present. Returns the id of the existing-or-created board view, or null
 * when creation failed (caller falls back to the normal active-view resolution).
 *
 * `views` is the already-fetched saved-view list for the scope, so the common
 * case (board view already exists) costs no extra round-trip.
 */
export async function ensureBoardView(
  views: SavedView[],
  scopeType: ViewScopeType,
  scopeId: string,
): Promise<string | null> {
  const existing = views.find((v) => v.type === 'board');
  if (existing) return existing.id;

  const res = await createSavedView({
    scopeType,
    scopeId: scopeType === 'EVERYTHING' ? null : scopeId,
    type: 'board',
    name: 'Board',
    isShared: true,
    isDefault: true,
    config: defaultBoardConfig(),
  });

  return res.ok ? res.data.id : null;
}
