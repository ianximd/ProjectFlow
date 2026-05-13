/**
 * Automation action executor.
 * Receives a single action and the event payload and performs the side-effect.
 */
import sql from 'mssql';
import { execSpOne } from '../../shared/lib/sqlClient.js';
import { subLogger } from '../../shared/lib/logger.js';
import type { AutomationAction } from '@projectflow/types';

const log = subLogger('automation');

export async function executeAction(
  action: AutomationAction,
  payload: Record<string, unknown>,
): Promise<void> {
  const taskId = payload['taskId'] as string | undefined;

  switch (action.type) {
    case 'TRANSITION_ISSUE': {
      if (!taskId || !action.toStatus) break;
      await execSpOne('usp_Task_Transition', [
        { name: 'TaskId',      type: sql.UniqueIdentifier, value: taskId },
        { name: 'NewStatus',   type: sql.NVarChar(100),    value: action.toStatus },
        { name: 'RequesterId', type: sql.UniqueIdentifier, value: payload['actorId'] ?? null },
      ]);
      break;
    }

    case 'ASSIGN_ISSUE': {
      if (!taskId) break;
      const assigneeId =
        action.assigneeId === 'REPORTER'
          ? (payload['reporterId'] as string | undefined) ?? null
          : action.assigneeId ?? null;
      await execSpOne('usp_Task_Update', [
        { name: 'TaskId',      type: sql.UniqueIdentifier, value: taskId },
        { name: 'Title',       type: sql.NVarChar(500),    value: null },
        { name: 'Description', type: sql.NVarChar(sql.MAX), value: null },
        { name: 'Type',        type: sql.NVarChar(20),     value: null },
        { name: 'Priority',    type: sql.NVarChar(20),     value: null },
        { name: 'AssigneeId',  type: sql.UniqueIdentifier, value: assigneeId },
        { name: 'SprintId',    type: sql.UniqueIdentifier, value: null },
        { name: 'EpicId',      type: sql.UniqueIdentifier, value: null },
        { name: 'StoryPoints', type: sql.Float,            value: null },
        { name: 'DueDate',     type: sql.Date,             value: null },
      ]);
      break;
    }

    case 'UNASSIGN_ISSUE': {
      if (!taskId) break;
      await execSpOne('usp_Task_Update', [
        { name: 'TaskId',      type: sql.UniqueIdentifier, value: taskId },
        { name: 'Title',       type: sql.NVarChar(500),    value: null },
        { name: 'Description', type: sql.NVarChar(sql.MAX), value: null },
        { name: 'Type',        type: sql.NVarChar(20),     value: null },
        { name: 'Priority',    type: sql.NVarChar(20),     value: null },
        { name: 'AssigneeId',  type: sql.UniqueIdentifier, value: null },
        { name: 'SprintId',    type: sql.UniqueIdentifier, value: null },
        { name: 'EpicId',      type: sql.UniqueIdentifier, value: null },
        { name: 'StoryPoints', type: sql.Float,            value: null },
        { name: 'DueDate',     type: sql.Date,             value: null },
      ]);
      break;
    }

    case 'SET_PRIORITY': {
      if (!taskId || !action.priority) break;
      await execSpOne('usp_Task_Update', [
        { name: 'TaskId',      type: sql.UniqueIdentifier, value: taskId },
        { name: 'Title',       type: sql.NVarChar(500),    value: null },
        { name: 'Description', type: sql.NVarChar(sql.MAX), value: null },
        { name: 'Type',        type: sql.NVarChar(20),     value: null },
        { name: 'Priority',    type: sql.NVarChar(20),     value: action.priority },
        { name: 'AssigneeId',  type: sql.UniqueIdentifier, value: null },
        { name: 'SprintId',    type: sql.UniqueIdentifier, value: null },
        { name: 'EpicId',      type: sql.UniqueIdentifier, value: null },
        { name: 'StoryPoints', type: sql.Float,            value: null },
        { name: 'DueDate',     type: sql.Date,             value: null },
      ]);
      break;
    }

    case 'ADD_COMMENT': {
      if (!taskId || !action.message) break;
      // System user id placeholder — replace with a real system user id
      const systemUserId = process.env.SYSTEM_USER_ID ?? null;
      if (!systemUserId) break;
      await execSpOne('usp_Comment_Create', [
        { name: 'TaskId',   type: sql.UniqueIdentifier,  value: taskId },
        { name: 'AuthorId', type: sql.UniqueIdentifier,  value: systemUserId },
        { name: 'Body',     type: sql.NVarChar(sql.MAX), value: action.message },
      ]);
      break;
    }

    case 'SEND_NOTIFICATION': {
      if (!action.message) break;
      const targetUserId = payload['assigneeId'] as string | undefined;
      if (!targetUserId) break;
      await execSpOne('usp_Notification_Create', [
        { name: 'UserId',  type: sql.UniqueIdentifier,  value: targetUserId },
        { name: 'Type',    type: sql.NVarChar(50),       value: 'AUTOMATION' },
        { name: 'Payload', type: sql.NVarChar(sql.MAX),  value: JSON.stringify({ message: action.message, taskId: taskId ?? null }) },
      ]);
      break;
    }

    case 'TRIGGER_WEBHOOK': {
      if (!action.webhookUrl) break;
      // Fire-and-forget — don't await so a slow external URL doesn't block the worker
      fetch(action.webhookUrl, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ event: payload }),
        signal:  AbortSignal.timeout(10_000),
      }).catch((err: any) => log.error({ err: err?.message }, 'webhook error'));
      break;
    }

    default:
      log.warn({ type: (action as any).type }, 'unknown action type');
  }
}
