/**
 * Wire snapshot fetchers for every resource the audit middleware mounts on.
 * Called once from `server.ts` before routes are mounted, so the
 * registry is populated before the first request hits the middleware.
 *
 * Coverage as of W43 (Option A + the 5-resource follow-up): all 9
 * resources the audit middleware audits have a single-row fetcher and
 * thus produce field-level diffs in AuditLog.OldValues / NewValues for
 * UPDATE/DELETE on a path with a UUID. Resources whose route paths
 * surface a sub-resource id (e.g. /workflows/:id/statuses/:statusId)
 * still degrade to the diff-less audit row — the fetcher gets the
 * status id, can't find a Workflow with that id, returns null. By
 * design.
 */

import { TaskRepository } from '../../modules/tasks/task.repository.js';
import { ProjectRepository } from '../../modules/projects/project.repository.js';
import { WorkspaceRepository } from '../../modules/workspaces/workspace.repository.js';
import { CommentRepository } from '../../modules/comments/comment.repository.js';
import { SprintRepository } from '../../modules/sprints/sprint.repository.js';
import { AutomationRepository } from '../../modules/automation/automation.repository.js';
import { WorkflowRepository } from '../../modules/workflows/workflow.repository.js';
import { WorkLogRepository } from '../../modules/worklogs/worklog.repository.js';
import { WebhookOutgoingRepository } from '../../modules/webhooks/webhook-outgoing.repository.js';
import { registerSnapshot } from './audit-snapshots.js';

export function registerAuditSnapshots(): void {
  const tasks      = new TaskRepository();
  const projects   = new ProjectRepository();
  const workspaces = new WorkspaceRepository();
  const comments   = new CommentRepository();
  const sprints    = new SprintRepository();
  const automation = new AutomationRepository();
  const workflows  = new WorkflowRepository();
  const worklogs   = new WorkLogRepository();
  const webhooks   = new WebhookOutgoingRepository();

  registerSnapshot('Task',            (id) => tasks.getById(id)      as Promise<Record<string, unknown> | null>);
  registerSnapshot('Project',         (id) => projects.getById(id)   as Promise<Record<string, unknown> | null>);
  registerSnapshot('Workspace',       (id) => workspaces.getById(id) as Promise<Record<string, unknown> | null>);
  registerSnapshot('Comment',         (id) => comments.getById(id)   as Promise<Record<string, unknown> | null>);
  registerSnapshot('Sprint',          (id) => sprints.getById(id));
  registerSnapshot('AutomationRule',  (id) => automation.getById(id));
  registerSnapshot('Workflow',        (id) => workflows.getById(id));
  registerSnapshot('WorkLog',         (id) => worklogs.getById(id));
  registerSnapshot('OutgoingWebhook', (id) => webhooks.getById(id));
}
