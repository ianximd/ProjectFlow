'use server';

import { submitPublicForm } from '../public/forms';
import type { SubmitFormResult } from '@projectflow/types';

export async function submitPublicFormAction(
  slug: string,
  answers: Record<string, unknown>,
  readToken: string,
): Promise<{ ok: true; data: SubmitFormResult } | { ok: false; error: string }> {
  try {
    const data = await submitPublicForm(slug, answers, readToken);
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Submit failed' };
  }
}
