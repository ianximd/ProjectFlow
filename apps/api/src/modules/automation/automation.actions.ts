/**
 * Automation action executor.
 * Receives a single action, the event payload, and a loop-guard context.
 * Task-mutating actions re-emit a typed domain event one causal level deeper so
 * OTHER rules can chain off them while the loop guard blocks self-retrigger.
 */
import sql from 'mssql';
import { execSpOne } from '../../shared/lib/sqlClient.js';
import { subLogger } from '../../shared/lib/logger.js';
import { emitAutomationEvent, type LoopContext } from './automation.bus.js';
import type { AutomationAction } from '@projectflow/types';

const log = subLogger('automation');

export interface ActionContext {
  workspaceId: string;
  projectId:   string | null;
  loop:        LoopContext;
}

const SYSTEM_ACTOR = (payload: Record<string, unknown>): string | null =>
  (payload['actorId'] as string | undefined) ?? process.env.SYSTEM_USER_ID ?? null;

export async function executeAction(
  action: AutomationAction,
  payload: Record<string, unknown>,
  ctx: ActionContext,
): Promise<void> {
  const taskId = payload['taskId'] as string | undefined;

  switch (action.type) {
    case 'CHANGE_STATUS': {
      if (!taskId || !action.toStatus) break;
      const fromStatus = (payload['status'] as string | undefined) ?? null;
      await execSpOne('usp_Task_Transition', [
        { name: 'TaskId',      type: sql.UniqueIdentifier, value: taskId },
        { name: 'NewStatus',   type: sql.NVarChar(100),    value: action.toStatus },
        { name: 'RequesterId', type: sql.UniqueIdentifier, value: payload['actorId'] ?? null },
      ]);
      if (ctx.projectId) {
        void emitAutomationEvent({
          type: 'STATUS_CHANGED', workspaceId: ctx.workspaceId, projectId: ctx.projectId,
          taskId, actorId: SYSTEM_ACTOR(payload) ?? '', fromStatus, toStatus: action.toStatus,
          loop: ctx.loop,
        });
      }
      break;
    }

    case 'ASSIGN': {
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
      if (ctx.projectId) {
        void emitAutomationEvent({
          type: 'ASSIGNEE_CHANGED', workspaceId: ctx.workspaceId, projectId: ctx.projectId,
          taskId, actorId: SYSTEM_ACTOR(payload) ?? '', from: null, to: assigneeId,
          loop: ctx.loop,
        });
      }
      break;
    }

    case 'UNASSIGN': {
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
      if (ctx.projectId) {
        void emitAutomationEvent({
          type: 'FIELD_CHANGED', workspaceId: ctx.workspaceId, projectId: ctx.projectId,
          taskId, actorId: SYSTEM_ACTOR(payload) ?? '', field: 'priority', from: null, to: action.priority,
          loop: ctx.loop,
        });
      }
      break;
    }

    case 'POST_COMMENT': {
      if (!taskId || !action.message) break;
      const systemUserId = SYSTEM_ACTOR(payload);
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

    case 'CALL_WEBHOOK': {
      if (!action.webhookUrl) break;
      // Legacy fire-and-forget fetch — replaced by the signed/audited dispatcher in 6c.
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
