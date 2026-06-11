import { WhiteboardRepository } from './whiteboard.repository.js';
import { extractShapeTitle, type WhiteboardShapeInput } from './whiteboard.shape.js';
import { TaskService } from '../tasks/task.service.js';
import { TaskRepository } from '../tasks/task.repository.js';
import { ListRepository } from '../hierarchy/list.repository.js';
import type {
  Whiteboard, WhiteboardSummary, WhiteboardTaskLink, WhiteboardScopeType,
  ConvertShapeToTaskResult, CreateTaskInput,
} from '@projectflow/types';

const repo = new WhiteboardRepository();
const listRepo = new ListRepository();
const taskService = new TaskService(new TaskRepository());

export class WhiteboardService {
  create(p: { workspaceId: string; scopeType: WhiteboardScopeType; scopeId: string; name: string; createdById: string }): Promise<Whiteboard> {
    return repo.create(p);
  }
  getById(id: string): Promise<Whiteboard | null> { return repo.getById(id); }
  listForScope(workspaceId: string, scopeType: WhiteboardScopeType | null, scopeId: string | null): Promise<WhiteboardSummary[]> {
    return repo.listForScope(workspaceId, scopeType, scopeId);
  }
  update(id: string, name?: string): Promise<Whiteboard | null> { return repo.update(id, name); }
  softDelete(id: string): Promise<Whiteboard | null> { return repo.softDelete(id); }
  getWorkspaceId(id: string): Promise<string | null> { return repo.getWorkspaceId(id); }
  listTaskLinks(whiteboardId: string): Promise<WhiteboardTaskLink[]> { return repo.listTaskLinks(whiteboardId); }

  // Collab persistence passthrough (used by the collab onLoad/onStore branch in Batch 5).
  getDoc(id: string) { return repo.getDoc(id); }
  saveDoc(id: string, docYjs: Buffer, docJson: string | null) { return repo.saveDoc(id, docYjs, docJson); }

  /**
   * Convert a tldraw shape into a real task in `targetListId` and link it back.
   *
   * The workspace is derived AUTHORITATIVELY from the target list (mirroring
   * DocsService.createTaskFromSelection) so the task is correctly scoped
   * regardless of which workspace the source whiteboard belongs to.
   * Title is derived by the pure extractor; createTask runs the normal
   * task-creation path (notifications/webhooks/progress).
   */
  async convertShapeToTask(
    whiteboardId: string,
    targetListId: string,
    shape: WhiteboardShapeInput,
    actorId: string,
  ): Promise<ConvertShapeToTaskResult> {
    // Resolve workspaceId from the target list — the authoritative source.
    // Mirror: docs.service.ts createTaskFromSelection lines 130-135.
    const listWorkspaceId = await listRepo.getWorkspaceId(targetListId);
    if (!listWorkspaceId) throw Object.assign(new Error('List not found'), { statusCode: 404 });

    const title = extractShapeTitle(shape);
    const input: CreateTaskInput = { workspaceId: listWorkspaceId, listId: targetListId, title, reporterId: actorId };
    const task = await taskService.createTask(input, actorId);
    const link = await repo.createTaskLink({
      whiteboardId,
      // createTask returns the raw usp_Task_Create row (PascalCase, no mapper) —
      // `task.id` is undefined; the real value is `.Id`. This casing-tolerant read
      // is LOAD-BEARING, not dead — do not "simplify" to `task.id` (NULL TaskId).
      taskId: (task as any).id ?? (task as any).Id,
      shapeId: shape.id,
      createdById: actorId,
    });
    return { task, link };
  }
}

export const whiteboardService = new WhiteboardService();
