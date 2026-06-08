import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks for the delegated services (match the REAL export shapes) ──────────────
// Hoisted so the vi.mock factories (themselves hoisted to the top of the file)
// can safely reference these fns.
const {
  setValue, linkTask, tagList, tagCreate, resolveOrCreate,
  taskCreate, setAssignees, moveTask, applyTpl, dispatch, emit, publishMove, execSpOne,
} = vi.hoisted(() => ({
  setValue:        vi.fn(async (..._a: unknown[]) => {}),
  linkTask:        vi.fn(async (..._a: unknown[]) => {}),
  tagList:         vi.fn(async (..._a: unknown[]) => [] as Array<{ id: string; name: string }>),
  tagCreate:       vi.fn(async (..._a: unknown[]) => ({ id: 'TAG-NEW', name: 'urgent' })),
  resolveOrCreate: vi.fn(async (..._a: unknown[]) => 'TAG-RESOLVED'),
  taskCreate:      vi.fn(async (..._a: unknown[]) => ({ Id: 'NEW-TASK', ProjectId: 'P1', WorkspaceId: 'W1' })),
  setAssignees:    vi.fn(async (..._a: unknown[]) => [] as unknown[]),
  moveTask:        vi.fn(async (..._a: unknown[]) => ({ id: 'T1', projectId: 'P1', workspaceId: 'W1' })),
  applyTpl:        vi.fn(async (..._a: unknown[]) => ({ rootId: 'NEW-ROOT', counts: { lists: 0, tasks: 1, views: 0, fields: 0 } })),
  dispatch:        vi.fn(async (..._a: unknown[]) => {}),
  emit:            vi.fn(async (..._a: unknown[]) => {}),
  publishMove:     vi.fn(async (..._a: unknown[]) => {}),
  execSpOne:       vi.fn(async (..._a: unknown[]) => [] as unknown[]),
}));

// customFieldService is a SINGLETON export.
vi.mock('../../customfields/customfield.service.js', () => ({ customFieldService: { setValue } }));
// tagService is a SINGLETON export; resolveOrCreate is added in Task 5.
vi.mock('../../tags/tag.service.js', () => ({
  tagService: { linkTask, list: tagList, create: tagCreate, resolveOrCreate },
}));
// TaskRepository is a CLASS export — the executor does `new TaskRepository()`.
vi.mock('../../tasks/task.repository.js', () => ({
  TaskRepository: class {
    create = taskCreate;
    setAssignees = setAssignees;
  },
}));
// TaskService is a CLASS export (constructed with a TaskRepository) — the
// executor does `new TaskService(taskRepo)`.
vi.mock('../../tasks/task.service.js', () => ({
  TaskService: class {
    moveTask = moveTask;
  },
}));
// templateService is a SINGLETON export.
vi.mock('../../templates/template.service.js', () => ({ templateService: { apply: applyTpl } }));
// webhookOutgoingService is a SINGLETON export.
vi.mock('../../webhooks/webhook-outgoing.service.js', () => ({ webhookOutgoingService: { dispatch } }));
// publishTaskMove lives in the graphql task-events module.
vi.mock('../../../graphql/task-events.js', () => ({ publishTaskMove: publishMove }));
// The bus — only emitAutomationEvent is consumed (via reEmit in the context helper).
vi.mock('../automation.bus.js', () => ({ emitAutomationEvent: emit }));
// SP client used by legacy branches.
vi.mock('../../../shared/lib/sqlClient.js', () => ({ execSpOne }));

import { executeAction } from '../automation.actions.js';
import type { ActionContext } from '../automation.actions.context.js';
import type { AutomationAction } from '@projectflow/types';

const ctx = (over: Partial<ActionContext> = {}): ActionContext => ({
  ruleId:      'R1',
  workspaceId: 'W1',
  projectId:   'P1',
  loop:        { depth: 0, causationChain: [] },
  payload:     { taskId: 'T1', reporterId: 'U-REP', actorId: 'U-ACT' },
  ...over,
});

const act = (a: Partial<AutomationAction> & { type: AutomationAction['type'] }): AutomationAction =>
  a as AutomationAction;

beforeEach(() => vi.clearAllMocks());

describe('executeAction — Phase 6c expansion', () => {
  describe('SET_FIELD', () => {
    it('sets the custom-field value and re-emits FIELD_CHANGED one level deeper', async () => {
      await executeAction(act({ type: 'SET_FIELD', fieldId: 'F-1', fieldValue: 'hi' }), ctx());
      expect(setValue).toHaveBeenCalledWith('T1', 'F-1', 'hi');
      expect(emit).toHaveBeenCalledTimes(1);
      expect(emit.mock.calls[0][0]).toMatchObject({
        type: 'FIELD_CHANGED',
        field: 'F-1',
        to: 'hi',
        loop: { depth: 1, causationChain: ['R1'] },
      });
    });
  });

  describe('ADD_TAG', () => {
    it('links an explicit tagId without resolving a name', async () => {
      await executeAction(act({ type: 'ADD_TAG', tagId: 'TAG-1' }), ctx());
      expect(linkTask).toHaveBeenCalledWith('T1', 'TAG-1');
      expect(resolveOrCreate).not.toHaveBeenCalled();
    });

    it('resolves a tagName in the task space then links it', async () => {
      await executeAction(act({ type: 'ADD_TAG', tagName: 'urgent' }), ctx());
      expect(resolveOrCreate).toHaveBeenCalledWith('P1', 'urgent');
      expect(linkTask).toHaveBeenCalledWith('T1', 'TAG-RESOLVED');
    });
  });

  describe('CREATE_SUBTASK', () => {
    it('creates a subtask under the current task and re-emits TASK_CREATED for the new id', async () => {
      await executeAction(
        act({ type: 'CREATE_SUBTASK', title: 'child', newPriority: 'HIGH' }),
        ctx({ payload: { taskId: 'T1', listId: 'L-1', actorId: 'U-ACT' } }),
      );
      expect(taskCreate).toHaveBeenCalledTimes(1);
      const input = taskCreate.mock.calls[0][0] as Record<string, unknown>;
      expect(input).toMatchObject({
        title: 'child',
        workspaceId: 'W1',
        reporterId: 'U-ACT',
        parentTaskId: 'T1',
        priority: 'HIGH',
      });
      expect(emit).toHaveBeenCalledTimes(1);
      expect(emit.mock.calls[0][0]).toMatchObject({
        type: 'TASK_CREATED',
        taskId: 'NEW-TASK',
        loop: { depth: 1, causationChain: ['R1'] },
      });
    });
  });

  describe('CREATE_TASK', () => {
    it('creates a top-level task (no parent) in the payload list', async () => {
      await executeAction(
        act({ type: 'CREATE_TASK', title: 'standalone' }),
        ctx({ payload: { taskId: 'T1', listId: 'L-9', actorId: 'U-ACT' } }),
      );
      const input = taskCreate.mock.calls[0][0] as Record<string, unknown>;
      expect(input).toMatchObject({ title: 'standalone', listId: 'L-9', workspaceId: 'W1' });
      expect(input.parentTaskId == null).toBe(true);
    });
  });

  describe('MOVE_TASK', () => {
    it('moves the task and does NOT re-emit (no matching bus event)', async () => {
      await executeAction(
        act({ type: 'MOVE_TASK', targetListId: 'L-2', targetPosition: 5 }),
        ctx(),
      );
      expect(moveTask).toHaveBeenCalledWith('T1', 'L-2', 5);
      expect(emit).not.toHaveBeenCalled();
      // moveTask does NOT publish the board event internally, so the executor does.
      expect(publishMove).toHaveBeenCalledTimes(1);
    });
  });

  describe('APPLY_TEMPLATE', () => {
    it('applies the template under the payload list with the actor', async () => {
      await executeAction(
        act({ type: 'APPLY_TEMPLATE', templateId: 'TPL-1' }),
        ctx({ payload: { taskId: 'T1', listId: 'L-3', actorId: 'U-ACT' } }),
      );
      expect(applyTpl).toHaveBeenCalledTimes(1);
      const [tplId, input, actor] = applyTpl.mock.calls[0];
      expect(tplId).toBe('TPL-1');
      expect(input).toMatchObject({ targetParentId: 'L-3' });
      expect(actor).toBe('U-ACT');
      expect(emit).not.toHaveBeenCalled();
    });
  });

  describe('CALL_WEBHOOK', () => {
    it('dispatches via the signed outgoing-webhook service and does NOT raw-fetch', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
      await executeAction(act({ type: 'CALL_WEBHOOK', webhookEvent: 'task.escalated' }), ctx());
      expect(dispatch).toHaveBeenCalledTimes(1);
      const [ws, event, body] = dispatch.mock.calls[0];
      expect(ws).toBe('W1');
      expect(event).toBe('task.escalated');
      expect(body).toMatchObject({ ruleId: 'R1', taskId: 'T1' });
      expect(fetchSpy).not.toHaveBeenCalled();
      fetchSpy.mockRestore();
    });

    it('falls back to "automation.fired" when no webhookEvent is set', async () => {
      await executeAction(act({ type: 'CALL_WEBHOOK' }), ctx());
      expect(dispatch).toHaveBeenCalledTimes(1);
      expect(dispatch.mock.calls[0][1]).toBe('automation.fired');
    });
  });
});
