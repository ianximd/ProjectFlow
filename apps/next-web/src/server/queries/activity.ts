import 'server-only';
import { cache } from 'react';
import type { AuditLogPage, ViewScopeType } from '@projectflow/types';
import { gqlData } from './views';

// ── Activity feed SSR query ──────────────────────────────────────────────────
// The GraphQL `activityFeed` query is the Phase 9e backend (Batch A). It returns
// an AuditLogPage whose `entries[].oldValues`/`newValues` are stored as JSON
// strings on the wire (the schema serialises them as String scalars). `parseEntry`
// revives them back to objects so the UI can display structured diffs.

const ACTIVITY_FEED_QUERY = /* GraphQL */ `
  query ActivityFeed(
    $scopeType: String!
    $scopeId:   String
    $wsId:      String
    $page:      Int
    $pageSize:  Int
    $actor:     String
    $action:    String
  ) {
    activityFeed(
      scopeType: $scopeType
      scopeId:   $scopeId
      workspaceId: $wsId
      page:      $page
      pageSize:  $pageSize
      actor:     $actor
      action:    $action
    ) {
      total
      page
      pageSize
      entries {
        id
        workspaceId
        userId
        userEmail
        action
        resource
        resourceId
        oldValues
        ipAddress
        createdAt
      }
    }
  }
`;

/** JSON-string → object reviver for AuditLogEntry.oldValues / newValues.
 *  The GraphQL schema serialises these as String scalars; we parse them here
 *  so callers always receive ready-to-use Record<string, unknown> | null. */
function parseEntry(raw: Record<string, unknown>): import('@projectflow/types').AuditLogEntry {
  return {
    id:          raw['id'] as string,
    workspaceId: (raw['workspaceId'] as string | null) ?? null,
    userId:      raw['userId'] as string,
    userEmail:   (raw['userEmail'] as string | null) ?? null,
    action:      raw['action'] as string,
    resource:    raw['resource'] as string,
    resourceId:  (raw['resourceId'] as string | null) ?? null,
    oldValues:   tryParseJson(raw['oldValues'] as string | null),
    newValues:   tryParseJson(raw['newValues'] as string | null),
    ipAddress:   (raw['ipAddress'] as string | null) ?? null,
    userAgent:   (raw['userAgent'] as string | null) ?? null,
    createdAt:   raw['createdAt'] as string,
  };
}

function tryParseJson(v: string | null | undefined): Record<string, unknown> | null {
  if (v == null || v === '') return null;
  try { return JSON.parse(v) as Record<string, unknown>; } catch { return null; }
}

/** SSR-fetch the activity feed for a view scope.
 *  Returns a full AuditLogPage (with parsed oldValues/newValues) or null on
 *  error (so the activity view can fall back to an empty feed). */
export const getActivityFeed = cache(async (
  scopeType: ViewScopeType,
  scopeId: string | null,
  workspaceId: string | undefined,
  page = 1,
  pageSize = 50,
  actor?: string,
  action?: string,
): Promise<AuditLogPage | null> => {
  try {
    const { activityFeed } = await gqlData<{
      activityFeed: {
        total: number;
        page: number;
        pageSize: number;
        entries: Record<string, unknown>[];
      } | null;
    }>(ACTIVITY_FEED_QUERY, {
      scopeType,
      scopeId:  scopeId ?? null,
      wsId:     workspaceId ?? null,
      page,
      pageSize,
      actor:    actor ?? null,
      action:   action ?? null,
    });

    if (!activityFeed) return { entries: [], total: 0, page, pageSize };

    return {
      total:    activityFeed.total,
      page:     activityFeed.page,
      pageSize: activityFeed.pageSize,
      entries:  (activityFeed.entries ?? []).map(parseEntry),
    };
  } catch {
    return null;
  }
});
