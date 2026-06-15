import { resolveAppEnabled, resolveAllApps, type OverrideRow } from './app-registry.js';
import { AppRepository } from './app.repository.js';
import { TaskRepository } from '../tasks/task.repository.js';
import { ListRepository } from '../hierarchy/list.repository.js';
import type { AppKey, AppScopeType, AppToggle, ResolvedApp } from '@projectflow/types';

export interface ScopeNode {
  workspaceId: string;
  scopeType:   AppScopeType;
  scopeId:     string | null;
}

const repo     = new AppRepository();
const taskRepo = new TaskRepository();
const listRepo = new ListRepository();

export class AppService {
  async isEnabled(appKey: AppKey, scope: ScopeNode): Promise<boolean> {
    const chain = await repo.listChainForScope(scope.workspaceId, scope.scopeType, scope.scopeId);
    return resolveAppEnabled(appKey, chain).enabled;
  }

  async resolveAll(scope: ScopeNode): Promise<ResolvedApp[]> {
    const chain = await repo.listChainForScope(scope.workspaceId, scope.scopeType, scope.scopeId);
    return resolveAllApps(chain);
  }

  resolveAllFromChain(chain: OverrideRow[]): ResolvedApp[] {
    return resolveAllApps(chain);
  }

  listForScope(scope: ScopeNode): Promise<AppToggle[]> {
    return repo.listForScope(scope.workspaceId, scope.scopeType, scope.scopeId);
  }

  setToggle(
    scope: ScopeNode,
    appKey: AppKey,
    enabled: boolean | null,
    updatedBy: string | null,
  ): Promise<AppToggle | null> {
    return repo.setOverride(scope.workspaceId, scope.scopeType, scope.scopeId, appKey, enabled, updatedBy);
  }

  chainForScope(scope: ScopeNode): Promise<OverrideRow[]> {
    return repo.listChainForScope(scope.workspaceId, scope.scopeType, scope.scopeId);
  }

  /** Resolve the most-specific scope node for a task: its List (falling back to its Space). */
  async scopeNodeForTask(taskId: string): Promise<ScopeNode | null> {
    const task = await taskRepo.getById(taskId);
    const listId = (task as any)?.listId ?? (task as any)?.ListId ?? null;
    if (!listId) {
      const workspaceId = await taskRepo.getWorkspaceId(taskId);
      const projectId   = (task as any)?.projectId ?? (task as any)?.ProjectId ?? null;
      if (!workspaceId || !projectId) return null;
      return { workspaceId, scopeType: 'space', scopeId: projectId };
    }
    const workspaceId = await listRepo.getWorkspaceId(listId);
    if (!workspaceId) return null;
    return { workspaceId, scopeType: 'list', scopeId: listId };
  }
}

export const appService = new AppService();
