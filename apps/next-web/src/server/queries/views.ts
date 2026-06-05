import 'server-only';
import { cache } from 'react';
import type { SavedView, ViewConfig, ViewGroup } from '@projectflow/types';
import { ApiError } from '../api';
import { runGraphql } from '../actions/graphql';
import { normalizeTask, type Task } from './normalize-task';

// ── Views are a GraphQL-only feature (no REST endpoints). These SSR helpers
//    wrap the shared `runGraphql` server action: GraphQL transports errors as a
//    200 with an `errors` array (Yoga convention), so `gqlData` re-raises the
//    first error as the same `ApiError` the REST helpers throw — that way the
//    server actions in actions/views.ts can map failures through `toActionError`
//    exactly like the REST-based task actions do. ───────────────────────────────

interface GqlError { message?: string; extensions?: { code?: string; status?: number } }
interface GqlBody<T> { data?: T; errors?: GqlError[] }

/** Run a GraphQL operation and return the unwrapped `data`, raising an ApiError
 *  (preserving the backend error code + HTTP status) when the response carries
 *  a GraphQL `errors` array or a non-2xx status. */
export async function gqlData<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const { status, body } = await runGraphql(query, variables);
  const b = (body ?? {}) as GqlBody<T>;
  if (Array.isArray(b.errors) && b.errors.length > 0) {
    const e = b.errors[0]!;
    throw new ApiError(e.message ?? 'GraphQL request failed', e.extensions?.status ?? status, e.extensions?.code);
  }
  if (status < 200 || status >= 300) {
    throw new ApiError(`GraphQL request failed (${status})`, status);
  }
  return b.data as T;
}

// ── SavedView shape returned by the schema: `config` is a JSON string. ─────────
interface RawSavedView extends Omit<SavedView, 'config'> { config: string }

/** An empty-but-valid config (filter + sort are required on ViewConfig). */
const EMPTY_VIEW_CONFIG: ViewConfig = { filter: { conjunction: 'AND', rules: [] }, sort: [] };

/** Parse a view's stored `config` JSON. A malformed/empty string would otherwise
 *  throw a SyntaxError inside this cache()-wrapped SSR helper and surface as a
 *  full-page 500; fall back to an empty config so the surface still renders. */
function parseViewConfig(raw: string): ViewConfig {
  try {
    const parsed = JSON.parse(raw) as Partial<ViewConfig>;
    return {
      ...EMPTY_VIEW_CONFIG,
      ...parsed,
      filter: parsed.filter ?? EMPTY_VIEW_CONFIG.filter,
      sort: parsed.sort ?? EMPTY_VIEW_CONFIG.sort,
    };
  } catch {
    return EMPTY_VIEW_CONFIG;
  }
}

const SAVED_VIEWS_QUERY = /* GraphQL */ `
  query SavedViews($scopeType: String!, $scopeId: String, $workspaceId: String) {
    savedViews(scopeType: $scopeType, scopeId: $scopeId, workspaceId: $workspaceId) {
      id
      workspaceId
      ownerId
      scopeType
      scopeId
      type
      name
      isShared
      isDefault
      position
      config
    }
  }
`;

/** Saved views for a scope. Parses each view's `config` JSON string back into a
 *  `ViewConfig` object so callers receive ready-to-use `SavedView[]`. */
export const getSavedViews = cache(async (
  scopeType: SavedView['scopeType'],
  scopeId: string | null,
  workspaceId?: string,
): Promise<SavedView[]> => {
  const { savedViews } = await gqlData<{ savedViews: RawSavedView[] }>(SAVED_VIEWS_QUERY, {
    scopeType,
    scopeId: scopeId ?? null,
    workspaceId: workspaceId ?? null,
  });
  return (savedViews ?? []).map((v) => ({
    ...v,
    config: parseViewConfig(v.config),
  }));
});

const VIEW_TASKS_QUERY = /* GraphQL */ `
  query ViewTasks($viewId: String!, $page: Int, $meMode: Boolean) {
    viewTasks(viewId: $viewId, page: $page, meMode: $meMode) {
      total
      groups { key label count }
      tasks {
        id
        issueKey
        title
        description
        status
        priority
        type
        storyPoints
        dueDate
        sprintId
        customFieldValues
      }
    }
  }
`;

/** A paged view result with tasks normalized to the stable camelCase `Task`
 *  shape (via the shared `normalizeTask`) the board/list components consume. */
export interface ViewTaskPageResult {
  total: number;
  tasks: Task[];
  groups: ViewGroup[];
}

/** Run a saved view and return its paged tasks (mapped through `normalizeTask`)
 *  plus group aggregates. */
export const getViewTasks = cache(async (
  viewId: string,
  page = 1,
  meMode = false,
): Promise<ViewTaskPageResult> => {
  const { viewTasks } = await gqlData<{
    viewTasks: { total: number; groups: ViewGroup[] | null; tasks: Record<string, unknown>[] } | null;
  }>(VIEW_TASKS_QUERY, { viewId, page, meMode });

  return {
    total: viewTasks?.total ?? 0,
    tasks: (viewTasks?.tasks ?? []).map(normalizeTask),
    groups: viewTasks?.groups ?? [],
  };
});

const PREVIEW_VIEW_TASKS_QUERY = /* GraphQL */ `
  query PreviewViewTasks(
    $scopeType: String!, $scopeId: String, $config: String!,
    $page: Int, $meMode: Boolean, $workspaceId: String
  ) {
    previewViewTasks(
      scopeType: $scopeType, scopeId: $scopeId, config: $config,
      page: $page, meMode: $meMode, workspaceId: $workspaceId
    ) {
      total
      groups { key label count }
      tasks {
        id
        issueKey
        title
        description
        status
        priority
        type
        storyPoints
        dueDate
        sprintId
        customFieldValues
      }
    }
  }
`;

/** Run an UNSAVED `ViewConfig` against a scope and return its paged tasks (same
 *  `ViewTaskPageResult` shape as `getViewTasks`). The filter-builder uses this to
 *  show a live preview/count of an in-progress config. `config` is serialized to
 *  the JSON string the schema's String arg expects. */
export const previewViewTasks = cache(async (
  scopeType: SavedView['scopeType'],
  scopeId: string | null,
  config: ViewConfig,
  page = 1,
  meMode = false,
  workspaceId?: string,
): Promise<ViewTaskPageResult> => {
  const { previewViewTasks: r } = await gqlData<{
    previewViewTasks: { total: number; groups: ViewGroup[] | null; tasks: Record<string, unknown>[] } | null;
  }>(PREVIEW_VIEW_TASKS_QUERY, {
    scopeType,
    scopeId: scopeId ?? null,
    config: JSON.stringify(config),
    page,
    meMode,
    workspaceId: workspaceId ?? null,
  });

  return {
    total: r?.total ?? 0,
    tasks: (r?.tasks ?? []).map(normalizeTask),
    groups: r?.groups ?? [],
  };
});
