/**
 * Automation action executor.
 * Receives a single action and a loop-guard ActionContext (which carries the
 * triggering event payload). Task-mutating actions re-emit a typed domain event
 * one causal level deeper so OTHER rules can chain off them while the loop guard
 * blocks self-retrigger.
 *
 * Phase 6c: the executor is expanded with SET_FIELD / ADD_TAG / CREATE_TASK /
 * CREATE_SUBTASK / MOVE_TASK / APPLY_TEMPLATE, delegating to the existing
 * services, and CALL_WEBHOOK now fans out through the signed/audited outgoing-
 * webhook dispatcher instead of a raw fetch. The canonical ActionContext +
 * resolveActor + reEmit live in ./automation.actions.context.ts.
 */
import sql from 'mssql';
import { execSpOne } from '../../shared/lib/sqlClient.js';
import { subLogger } from '../../shared/lib/logger.js';
import {
  type ActionContext,
  SYSTEM_USER_ID,
  resolveActor,
  reEmit,
} from './automation.actions.context.js';
import { TaskRepository } from '../tasks/task.repository.js';
import { TaskService } from '../tasks/task.service.js';
import { ListRepository } from '../hierarchy/list.repository.js';
import { customFieldService } from '../customfields/customfield.service.js';
import { tagService } from '../tags/tag.service.js';
import { templateService } from '../templates/template.service.js';
import { webhookOutgoingService } from '../webhooks/webhook-outgoing.service.js';
import { publishTaskMove } from '../../graphql/task-events.js';
import type { AutomationDomainEvent } from './automation.bus.js';
import type { AutomationAction } from '@projectflow/types';

const log = subLogger('automation');

const taskRepo    = new TaskRepository();
const taskService = new TaskService(taskRepo);
const listRepo    = new ListRepository();

/**
 * Distributive `Omit` over the domain-event union: `Omit<Union, K>` collapses to
 * the union's COMMON keys, so a per-member literal (e.g. STATUS_CHANGED with
 * `fromStatus`) won't type-check against it. This distributes the omit across
 * each member so each event keeps its own fields. The canonical `reEmit` param
 * type stays as-is; we validate the literal here first, then hand it over.
 */
type DomainEventNoLoop = AutomationDomainEvent extends infer E
  ? E extends { type: string } ? Omit<E, 'loop'> : never
  : never;

/** Type-checked passthrough to the canonical loop-guarded re-emit helper. */
function emitDeeper(ctx: ActionContext, event: DomainEventNoLoop): Promise<void> {
  return reEmit(ctx, event as Omit<AutomationDomainEvent, 'loop'>);
}

export async function executeAction(
  action: AutomationAction,
  ctx: ActionContext,
): Promise<void> {
  const taskId    = ctx.payload['taskId'] as string | undefined;
  // task events in the bus union require a non-null projectId.
  const projectId = ctx.projectId ?? (ctx.payload['projectId'] as string | undefined) ?? null;

  switch (action.type) {
    case 'CHANGE_STATUS': {
      if (!taskId || !action.toStatus) break;
      const fromStatus = (ctx.payload['status'] as string | undefined) ?? null;
      await execSpOne('usp_Task_Transition', [
        { name: 'TaskId',      type: sql.UniqueIdentifier, value: taskId },
        { name: 'NewStatus',   type: sql.NVarChar(100),    value: action.toStatus },
        { name: 'RequesterId', type: sql.UniqueIdentifier, value: ctx.payload['actorId'] ?? null },
      ]);
      if (projectId) {
        await emitDeeper(ctx, {
          type: 'STATUS_CHANGED', workspaceId: ctx.workspaceId, projectId,
          taskId, actorId: resolveActor(ctx) ?? '', fromStatus, toStatus: action.toStatus,
        });
      }
      break;
    }

    case 'ASSIGN': {
      if (!taskId) break;
      const assigneeId =
        action.assigneeId === 'REPORTER'
          ? (ctx.payload['reporterId'] as string | undefined) ?? null
          : action.assigneeId ?? null;
      if (!assigneeId) break;
      await taskRepo.setAssignees(taskId, [assigneeId]);
      if (projectId) {
        await emitDeeper(ctx, {
          type: 'ASSIGNEE_CHANGED', workspaceId: ctx.workspaceId, projectId,
          taskId, actorId: resolveActor(ctx) ?? '', from: null, to: assigneeId,
        });
      }
      break;
    }

    case 'UNASSIGN': {
      if (!taskId) break;
      await taskRepo.setAssignees(taskId, []);
      if (projectId) {
        await emitDeeper(ctx, {
          type: 'ASSIGNEE_CHANGED', workspaceId: ctx.workspaceId, projectId,
          taskId, actorId: resolveActor(ctx) ?? '', from: null, to: null,
        });
      }
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
        { name: 'SprintId',    type: sql.UniqueIdentifier, value: null },
        { name: 'EpicId',      type: sql.UniqueIdentifier, value: null },
        { name: 'StoryPoints', type: sql.Float,            value: null },
        { name: 'DueDate',     type: sql.Date,             value: null },
      ]);
      if (projectId) {
        await emitDeeper(ctx, {
          type: 'FIELD_CHANGED', workspaceId: ctx.workspaceId, projectId,
          taskId, actorId: resolveActor(ctx) ?? '', field: 'priority', from: undefined, to: action.priority,
        });
      }
      break;
    }

    case 'SET_FIELD': {
      if (!taskId || !action.fieldId) break;
      await customFieldService.setValue(taskId, action.fieldId, action.fieldValue);
      if (projectId) {
        await emitDeeper(ctx, {
          type: 'FIELD_CHANGED', workspaceId: ctx.workspaceId, projectId,
          taskId, actorId: resolveActor(ctx) ?? '', field: action.fieldId, from: undefined, to: action.fieldValue,
        });
      }
      break;
    }

    case 'ADD_TAG': {
      if (!taskId) break;
      if (action.tagId) {
        await tagService.linkTask(taskId, action.tagId);
      } else if (action.tagName && projectId) {
        // Tags are scoped to a Space; projectId IS the space id at this layer.
        const tagId = await tagService.resolveOrCreate(projectId, action.tagName);
        await tagService.linkTask(taskId, tagId);
      }
      // No matching bus event for tag changes — no re-emit.
      break;
    }

    case 'CREATE_TASK': {
      const reporterId = resolveActor(ctx);
      if (!action.title || !reporterId) break;
      const listId = (ctx.payload['listId'] as string | undefined) ?? null;
      const created = await taskRepo.create({
        workspaceId:  ctx.workspaceId,
        projectId:    projectId ?? undefined,
        title:        action.title,
        description:  action.description ?? null,
        priority:     action.newPriority,
        reporterId,
        listId,
        parentTaskId: null,
      });
      const newId  = (created as any)?.id ?? (created as any)?.Id;
      const newPid = (created as any)?.projectId ?? (created as any)?.ProjectId;
      if (newId && newPid) {
        await emitDeeper(ctx, {
          type: 'TASK_CREATED', workspaceId: ctx.workspaceId, projectId: newPid,
          taskId: newId, actorId: reporterId, reporterId,
        });
      }
      break;
    }

    case 'CREATE_SUBTASK': {
      const reporterId = resolveActor(ctx);
      if (!action.title || !reporterId || !taskId) break;
      const listId = (ctx.payload['listId'] as string | undefined) ?? null;
      const created = await taskRepo.create({
        workspaceId:  ctx.workspaceId,
        projectId:    projectId ?? undefined,
        title:        action.title,
        description:  action.description ?? null,
        priority:     action.newPriority,
        reporterId,
        listId,
        parentTaskId: taskId,
      });
      const newId  = (created as any)?.id ?? (created as any)?.Id;
      const newPid = (created as any)?.projectId ?? (created as any)?.ProjectId;
      if (newId && newPid) {
        await emitDeeper(ctx, {
          type: 'TASK_CREATED', workspaceId: ctx.workspaceId, projectId: newPid,
          taskId: newId, actorId: reporterId, reporterId,
        });
      }
      break;
    }

    case 'MOVE_TASK': {
      if (!taskId || !action.targetListId) break;
      const targetWsId = await listRepo.getWorkspaceId(action.targetListId);
      if (!targetWsId || targetWsId.toLowerCase() !== ctx.workspaceId.toLowerCase()) {
        log.warn({ targetListId: action.targetListId, ruleWorkspaceId: ctx.workspaceId }, 'MOVE_TASK blocked: target list is in a different workspace');
        break;
      }
      const oldProjectId = projectId;
      const moved = await taskService.moveTask(taskId, action.targetListId, action.targetPosition ?? Date.now());
      // taskService.moveTask dispatches the outgoing webhook but does NOT publish
      // the live board event — publish it here so the board reacts.
      if (moved) await publishTaskMove(oldProjectId, moved);
      // Its natural event (TASK_UPDATED) is not in the bus union — no re-emit.
      break;
    }

    case 'APPLY_TEMPLATE': {
      const actor  = resolveActor(ctx);
      const listId = (ctx.payload['listId'] as string | undefined) ?? null;
      if (!action.templateId || !listId || !actor) break;
      await templateService.apply(
        action.templateId,
        { targetParentId: listId, anchorDate: new Date().toISOString() },
        actor,
      );
      break;
    }

    case 'POST_COMMENT': {
      if (!taskId || !action.message) break;
      const systemUserId = resolveActor(ctx);
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
      const targetUserId = ctx.payload['assigneeId'] as string | undefined;
      if (!targetUserId) break;
      await execSpOne('usp_Notification_Create', [
        { name: 'UserId',  type: sql.UniqueIdentifier,  value: targetUserId },
        { name: 'Type',    type: sql.NVarChar(50),       value: 'AUTOMATION' },
        { name: 'Payload', type: sql.NVarChar(sql.MAX),  value: JSON.stringify({ message: action.message, taskId: taskId ?? null }) },
      ]);
      break;
    }

    case 'CALL_WEBHOOK': {
      // 6c: fan out through the signed/audited outgoing-webhook dispatcher.
      // The legacy raw fetch (action.webhookUrl) is removed.
      await webhookOutgoingService.dispatch(
        ctx.workspaceId,
        action.webhookEvent ?? 'automation.fired',
        { ruleId: ctx.ruleId, taskId: taskId ?? null, payload: ctx.payload },
      );
      break;
    }

    default:
      log.warn({ type: (action as any).type }, 'unknown action type');
  }
}

// SYSTEM_USER_ID is re-exported for callers/tests that need the fallback actor.
export { SYSTEM_USER_ID };
