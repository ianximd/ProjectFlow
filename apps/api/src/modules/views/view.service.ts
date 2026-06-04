import { randomUUID } from 'node:crypto';
import { ViewRepository } from './view.repository.js';
import { CustomFieldRepository } from '../customfields/customfield.repository.js';
import { buildCatalog } from './query/field-catalog.js';
import { compile, builtinGroupExpr } from './query/compiler.js';
import { ViewNotFoundError, ViewValidationError } from './view.errors.js';
import type { SavedView, ViewConfig, ViewScopeType, ViewType, ViewTaskPage, CustomField } from '@projectflow/types';

interface ScopeNode { workspaceId: string; scopePath: string | null }

export class ViewService {
  private repo = new ViewRepository();
  private cfRepo = new CustomFieldRepository();

  private async resolveScope(
    scopeType: ViewScopeType,
    scopeId: string | null,
    fallbackWorkspaceId?: string,
  ): Promise<ScopeNode> {
    if (scopeType === 'EVERYTHING') {
      if (!fallbackWorkspaceId) throw new ViewValidationError('EVERYTHING scope requires a workspaceId');
      return { workspaceId: fallbackWorkspaceId, scopePath: null };
    }
    if (!scopeId) throw new ViewValidationError(`scopeId required for ${scopeType} scope`);
    // Reuse the existing CustomFieldRepository helper which calls usp_CustomField_GetScopeNode
    // (@ScopeType NVARCHAR(8), @ScopeId UNIQUEIDENTIFIER → WorkspaceId, ScopePath)
    const node = await this.cfRepo.getScopeNode(scopeType as any, scopeId);
    if (!node) throw new ViewValidationError('Scope node not found');
    return { workspaceId: node.workspaceId, scopePath: node.scopePath };
  }

  private async catalogFor(scopeType: ViewScopeType, scopeId: string | null) {
    let fields: CustomField[] = [];
    if (scopeType !== 'EVERYTHING' && scopeId) {
      // CustomFieldRepository.list(scopeType: CustomFieldScopeType, scopeId: string)
      fields = await this.cfRepo.list(scopeType as any, scopeId);
    }
    return buildCatalog(fields);
  }

  private async validateConfig(
    scopeType: ViewScopeType,
    scopeId: string | null,
    scope: ScopeNode,
    config: ViewConfig,
  ): Promise<void> {
    const catalog = await this.catalogFor(scopeType, scopeId);
    try {
      compile({
        workspaceId: scope.workspaceId,
        scope: { scopeType, scopePath: scope.scopePath },
        catalog,
        filter: config.filter ?? { conjunction: 'AND', rules: [] },
        sort: config.sort ?? [],
      });
    } catch (e) {
      throw new ViewValidationError((e as Error).message);
    }
  }

  async create(
    userId: string,
    input: {
      scopeType: ViewScopeType;
      scopeId: string | null;
      type: ViewType;
      name: string;
      isShared: boolean;
      isDefault: boolean;
      config: ViewConfig;
      workspaceId?: string;
    },
  ): Promise<SavedView> {
    const scope = await this.resolveScope(input.scopeType, input.scopeId, input.workspaceId);
    await this.validateConfig(input.scopeType, input.scopeId, scope, input.config);
    return this.repo.create({
      id: randomUUID(),
      workspaceId: scope.workspaceId,
      ownerId: userId,
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      scopePath: scope.scopePath,
      type: input.type,
      name: input.name,
      isShared: input.isShared,
      isDefault: input.isDefault,
      config: JSON.stringify(input.config),
      position: Date.now(),
    });
  }

  async update(
    id: string,
    patch: { name?: string; isShared?: boolean; isDefault?: boolean; config?: ViewConfig },
  ): Promise<SavedView> {
    const existing = await this.getOrThrow(id);
    if (patch.config) {
      const scope = await this.resolveScope(existing.scopeType, existing.scopeId, existing.workspaceId);
      await this.validateConfig(existing.scopeType, existing.scopeId, scope, patch.config);
    }
    const updated = await this.repo.update(id, {
      name: patch.name,
      isShared: patch.isShared,
      isDefault: patch.isDefault,
      config: patch.config ? JSON.stringify(patch.config) : undefined,
    });
    if (!updated) throw new ViewNotFoundError();
    return updated;
  }

  async delete(id: string): Promise<SavedView> {
    const v = await this.repo.delete(id);
    if (!v) throw new ViewNotFoundError();
    return v;
  }

  async reorder(id: string, position: number): Promise<SavedView> {
    const v = await this.repo.reorder(id, position);
    if (!v) throw new ViewNotFoundError();
    return v;
  }

  async list(
    userId: string,
    scopeType: ViewScopeType,
    scopeId: string | null,
    workspaceId?: string,
  ): Promise<SavedView[]> {
    const scope = await this.resolveScope(scopeType, scopeId, workspaceId);
    return this.repo.list(scope.workspaceId, userId, scopeType, scopeId);
  }

  async getOrThrow(id: string): Promise<SavedView> {
    const v = await this.repo.getById(id);
    if (!v) throw new ViewNotFoundError();
    return v;
  }

  async runView(
    userId: string,
    id: string,
    opts: { page: number; pageSize?: number; meMode?: boolean },
  ): Promise<ViewTaskPage> {
    const view = await this.getOrThrow(id);
    return this.runConfig(view.scopeType, view.scopeId, view.config, opts, view.workspaceId, userId);
  }

  async runConfig(
    scopeType: ViewScopeType,
    scopeId: string | null,
    config: ViewConfig,
    opts: { page: number; pageSize?: number; meMode?: boolean },
    workspaceId: string | undefined,
    userId: string,
  ): Promise<ViewTaskPage> {
    const scope = await this.resolveScope(scopeType, scopeId, workspaceId);
    const catalog = await this.catalogFor(scopeType, scopeId);
    const compiled = compile({
      workspaceId: scope.workspaceId,
      scope: { scopeType, scopePath: scope.scopePath },
      catalog,
      filter: config.filter ?? { conjunction: 'AND', rules: [] },
      sort: config.sort ?? [],
      meUserId: (opts.meMode ?? config.meMode) ? userId : undefined,
    });
    const pageSize = opts.pageSize ?? config.pageSize ?? 25;
    const page = await this.repo.queryTasks(compiled, { page: opts.page, pageSize });
    if (config.groupBy) {
      page.groups = await this.repo.groupCounts(compiled, builtinGroupExpr(catalog, config.groupBy));
    }
    return page;
  }
}

export const viewService = new ViewService();
