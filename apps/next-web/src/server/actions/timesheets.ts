'use server';

import { revalidatePath } from 'next/cache';
import { requireSession } from '../session';
import { serverFetch } from '../api';
import { toActionError } from './error';
import type { ActionResult } from './result';
import type { Timesheet } from '@projectflow/types';

/** POST /timesheets/:id/submit — move a draft/rejected envelope to submitted. */
export async function submitTimesheet(id: string, note?: string): Promise<ActionResult<Timesheet>> {
  await requireSession();
  let data: Timesheet;
  try {
    data = await serverFetch<Timesheet>(`/timesheets/${encodeURIComponent(id)}/submit`, {
      method: 'POST',
      body:   JSON.stringify(note ? { note } : {}),
    });
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath('/timesheets');
  return { ok: true, data };
}

/** POST /timesheets/:id/review — approve or reject a submitted envelope. */
export async function reviewTimesheet(
  id: string,
  decision: 'approved' | 'rejected',
  note?: string,
): Promise<ActionResult<Timesheet>> {
  await requireSession();
  let data: Timesheet;
  try {
    data = await serverFetch<Timesheet>(`/timesheets/${encodeURIComponent(id)}/review`, {
      method: 'POST',
      body:   JSON.stringify({ decision, ...(note ? { note } : {}) }),
    });
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath('/timesheets');
  return { ok: true, data };
}
