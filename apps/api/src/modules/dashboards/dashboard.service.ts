import { randomUUID } from 'node:crypto';
import { DashboardRepository } from './dashboard.repository.js';
import { CustomFieldRepository } from '../customfields/customfield.repository.js';
import { canReadDashboard } from './card.aggregate.js';
import { DashboardNotFoundError, DashboardValidationError } from './dashboard.errors.js';
import type {
  Dashboard, DashboardCard, DashboardScopeType, CreateDashboardInput, UpdateDashboardInput,
  CreateDashboardCardInput, UpdateDashboardCardInput, ReorderCardEntry,
} from '@projectflow/types';

// Dashboard scope tokens are lowercase; the hierarchy scope-node SP keys on the
// uppercase hierarchy node types. EVERYTHING/workspace has no node.
const HIER: Record<Exclude<DashboardScopeType, 'workspace'>, 'SPACE' | 'FOLDER' | 'LIST'> = {
  space: 'SPACE', folder: 'FOLDER', list: 'LIST',
};

export interface ResolvedScope { workspaceId: string; scopePath: string | null }

export class DashboardService {
  private repo = new DashboardRepository();
  private cfRepo = new CustomFieldRepository();

  async resolveScope(scopeType: DashboardScopeType, scopeId: string | null, fallbackWorkspaceId?: string): Promise<ResolvedScope> {
    if (scopeType === 'workspace') {
      if (!fallbackWorkspaceId) throw new DashboardValidationError('workspace scope requires a workspaceId');
      return { workspaceId: fallbackWorkspaceId, scopePath: null };
    }
    if (!scopeId) throw new DashboardValidationError(`scopeId required for ${scopeType} scope`);
    const node = await this.cfRepo.getScopeNode(HIER[scopeType] as any, scopeId);
    if (!node) throw new DashboardValidationError('Scope node not found');
    return { workspaceId: node.workspaceId, scopePath: node.scopePath };
  }

  async create(userId: string, input: CreateDashboardInput): Promise<Dashboard> {
    const scope = await this.resolveScope(input.scopeType, input.scopeId, input.workspaceId);
    return this.repo.create({
      id: randomUUID(), workspaceId: scope.workspaceId, ownerId: userId,
      scopeType: input.scopeType, scopeId: input.scopeId, scopePath: scope.scopePath,
      name: input.name, description: input.description ?? null,
      visibility: input.visibility ?? 'shared', position: Date.now(),
    });
  }

  async list(userId: string, scopeType: DashboardScopeType, scopeId: string | null, workspaceId?: string): Promise<Dashboard[]> {
    const scope = await this.resolveScope(scopeType, scopeId, workspaceId);
    const dashboards = await this.repo.listByScope(scope.workspaceId, userId, scopeType, scopeId);
    return dashboards.filter((d) => canReadDashboard(d, userId));
  }

  /** Full dashboard incl. its cards (for the grid + the print layout). */
  async getWithCards(id: string): Promise<Dashboard> {
    const d = await this.getOrThrow(id);
    d.cards = await this.repo.listCards(id);
    return d;
  }

  async getOrThrow(id: string): Promise<Dashboard> {
    const d = await this.repo.getById(id);
    if (!d) throw new DashboardNotFoundError();
    return d;
  }

  async update(id: string, patch: UpdateDashboardInput): Promise<Dashboard> {
    const d = await this.repo.update(id, patch);
    if (!d) throw new DashboardNotFoundError();
    return d;
  }

  async delete(id: string): Promise<Dashboard> {
    const d = await this.repo.delete(id);
    if (!d) throw new DashboardNotFoundError();
    return d;
  }

  async setDefault(id: string): Promise<Dashboard> {
    const d = await this.repo.setDefault(id);
    if (!d) throw new DashboardNotFoundError();
    return d;
  }

  // ── Cards ──────────────────────────────────────────────────────────────
  async createCard(dashboardId: string, input: CreateDashboardCardInput): Promise<DashboardCard> {
    await this.getOrThrow(dashboardId);
    return this.repo.createCard({
      id: randomUUID(), dashboardId, type: input.type, title: input.title ?? null,
      config: input.config, layout: input.layout, position: input.position ?? Date.now(),
    });
  }

  async updateCard(id: string, patch: UpdateDashboardCardInput): Promise<DashboardCard> {
    const c = await this.repo.updateCard(id, patch);
    if (!c) throw new DashboardNotFoundError('Card not found');
    return c;
  }

  async deleteCard(id: string): Promise<DashboardCard> {
    const c = await this.repo.deleteCard(id);
    if (!c) throw new DashboardNotFoundError('Card not found');
    return c;
  }

  async reorderCards(dashboardId: string, cards: ReorderCardEntry[]): Promise<DashboardCard[]> {
    await this.getOrThrow(dashboardId);
    return this.repo.reorderCards(dashboardId, cards);
  }
}

export const dashboardService = new DashboardService();
