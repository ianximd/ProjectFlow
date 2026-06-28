'use server';
import { getTaskActivity } from '@/server/queries/activity';
import type { AuditLogPage } from '@projectflow/types';

export async function loadTaskActivity(taskId: string): Promise<AuditLogPage | null> {
  return getTaskActivity(taskId, 1, 50);
}
