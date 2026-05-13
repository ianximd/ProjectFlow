/**
 * Wire snapshot fetchers for every resource the audit middleware mounts on.
 * Called once from `server.ts` before routes are mounted, so the
 * registry is populated before the first request hits the middleware.
 *
 * Resources that already have a single-row getter in their repo are
 * registered here. Resources without one (Sprint, AutomationRule,
 * Workflow, WorkLog, OutgoingWebhook) fall back to the diff-less audit
 * row — the audit log still records WHO/WHAT/WHEN, just not the
 * field-level body. Add a getById to each repo (with a matching SP) to
 * extend coverage to those resources.
 */

import { TaskRepository } from '../../modules/tasks/task.repository.js';
import { ProjectRepository } from '../../modules/projects/project.repository.js';
import { WorkspaceRepository } from '../../modules/workspaces/workspace.repository.js';
import { CommentRepository } from '../../modules/comments/comment.repository.js';
import { registerSnapshot } from './audit-snapshots.js';

export function registerAuditSnapshots(): void {
  const tasks      = new TaskRepository();
  const projects   = new ProjectRepository();
  const workspaces = new WorkspaceRepository();
  const comments   = new CommentRepository();

  registerSnapshot('Task',      (id) => tasks.getById(id)      as Promise<Record<string, unknown> | null>);
  registerSnapshot('Project',   (id) => projects.getById(id)   as Promise<Record<string, unknown> | null>);
  registerSnapshot('Workspace', (id) => workspaces.getById(id) as Promise<Record<string, unknown> | null>);
  registerSnapshot('Comment',   (id) => comments.getById(id)   as Promise<Record<string, unknown> | null>);
}
