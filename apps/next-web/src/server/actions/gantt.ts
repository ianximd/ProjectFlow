'use server';

import { requireSession } from '../session';
import { gqlData } from '../queries/views';
import { toActionError } from './error';
import type { ActionResult } from './result';

/** Capture a named baseline (frozen snapshot of the view's task dates) via GraphQL.
 *  The Views surface has no REST routes, so this goes through the same GraphQL
 *  transport the SSR view queries use. The Gantt drag itself reuses the existing
 *  `updateTaskDates` roadmap action (PATCH /roadmap/tasks/:id/dates). */
export async function captureBaseline(viewId: string, name: string): Promise<ActionResult> {
  await requireSession();
  try {
    await gqlData(
      /* GraphQL */ `mutation($id:String!,$n:String!){ captureBaseline(viewId:$id,name:$n){ id name capturedAt } }`,
      { id: viewId, n: name },
    );
  } catch (e) {
    return toActionError(e);
  }
  return { ok: true };
}
