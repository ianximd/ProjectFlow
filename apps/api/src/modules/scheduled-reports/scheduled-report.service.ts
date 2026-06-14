import { ScheduledReportRepository, scheduledReportRepository } from './scheduled-report.repository.js';
import { computeNextOccurrence, validateRule, type RecurrenceRuleShape } from '../recurrence/recurrence.js';
import { deliverFor } from './delivery.js';
import { dashboardService } from '../dashboards/dashboard.service.js';
import { cardService } from '../dashboards/card.service.js';
import { accessService } from '../access/access.service.js';
import { isWorkspaceMember } from '../workspaces/membership.js';
import { subLogger } from '../../shared/lib/logger.js';
import type {
  ScheduledReport, ScheduledReportRun, ReportSnapshot, DeliveryChannel,
  CreateScheduledReportInput, UpdateScheduledReportInput, Dashboard, DashboardCard, CardData,
} from '@projectflow/types';

const log = subLogger('scheduled-report');

/** Thrown on a malformed cadence (reuses the recurrence rule validator). */
export class InvalidCadenceError extends Error {
  code = 'INVALID_CADENCE';
  constructor(message: string) { super(message); this.name = 'InvalidCadenceError'; }
}

/** Thrown when a schedule's dashboard belongs to a different workspace, or the
 *  owner cannot VIEW its scope — the cross-tenant binding that the snapshot would
 *  otherwise resolve under the owner's id without re-checking object-level access. */
export class ScheduleAccessError extends Error {
  code = 'SCHEDULE_FORBIDDEN';
  constructor(message: string) { super(message); this.name = 'ScheduleAccessError'; }
}

/** Thrown when a recipient is not a member of the schedule's workspace. */
export class RecipientNotMemberError extends Error {
  code = 'RECIPIENT_NOT_MEMBER';
  constructor(message: string) { super(message); this.name = 'RecipientNotMemberError'; }
}

/** Next run STRICTLY after `from`, or null when the cadence has ended. Pure —
 *  reuses the Phase 5 recurrence evaluator. */
export function computeNextRun(cadence: RecurrenceRuleShape, from: Date): Date | null {
  return computeNextOccurrence(cadence, from);
}

/** Stable per-occurrence key: the occurrence's ISO timestamp. */
export function periodKeyFor(occurrence: Date): string {
  return occurrence.toISOString();
}

/**
 * Assert that `userId` may snapshot `dash` on behalf of a schedule in
 * `scheduleWorkspaceId`. Mirrors the dashboard card-data route's gate exactly:
 *   - the dashboard MUST belong to the schedule's workspace (binding — closes
 *     the cross-workspace dashboardId hole), and
 *   - for a node-scoped dashboard, the user must hold object-level VIEW on the
 *     scope node (accessService.can); for a workspace-scoped dashboard, the user
 *     must be a workspace member (the card-data route's dashboard.read RBAC).
 * Throws ScheduleAccessError when denied so the snapshot path fails CLOSED — the
 * snapshot resolver (viewService.runConfig) itself does NOT re-check membership,
 * it trusts the caller, so this gate is what makes owner-scoped resolution safe.
 */
export async function assertDashboardSnapshotAccess(
  dash: Dashboard,
  scheduleWorkspaceId: string,
  userId: string,
): Promise<void> {
  if (dash.workspaceId !== scheduleWorkspaceId) {
    throw new ScheduleAccessError('dashboard does not belong to the schedule workspace');
  }
  if (dash.scopeType === 'workspace' || !dash.scopeId) {
    if (!(await isWorkspaceMember(dash.workspaceId, userId))) {
      throw new ScheduleAccessError('owner is not a member of the dashboard workspace');
    }
    return;
  }
  const node = dash.scopeType.toUpperCase() as 'SPACE' | 'FOLDER' | 'LIST';
  if (!(await accessService.can(userId, node, dash.scopeId, 'VIEW'))) {
    throw new ScheduleAccessError('owner lacks VIEW on the dashboard scope');
  }
}

// ── Injectable cores (unit-tested without DB) ────────────────────────────────

export interface SnapshotDeps {
  /** Returns the dashboard WITH its cards loaded (dashboardService.getWithCards). */
  getDashboard: (id: string) => Promise<Dashboard>;
  /** Fail-closed object-level gate: throws if the schedule owner may not read the
   *  dashboard (workspace mismatch or no VIEW). The snapshot resolver trusts the
   *  caller, so this is the authoritative access check on the snapshot path. */
  assertAccess: (dashboard: Dashboard, schedule: ScheduledReport) => Promise<void>;
  /** Resolves one card under a user's access (cardService.resolve). */
  resolveCard:  (card: DashboardCard, dashboard: Dashboard, userId: string) => Promise<CardData>;
}

/**
 * Resolve every card on the bound dashboard through card.service under the
 * schedule OWNER's access, and FREEZE the result. JSON round-trip deep-clones the
 * resolved data so a later mutation of the live source can't change the snapshot.
 * assertAccess runs BEFORE any card resolves so a mis-bound/forbidden dashboard
 * fails closed (the caller records a 'failed' run, never a leaked snapshot).
 */
export async function snapshotWith(
  schedule: ScheduledReport,
  periodKey: string,
  deps: SnapshotDeps,
): Promise<ReportSnapshot> {
  const dashboardId = schedule.dashboardId;
  const cardsOut: ReportSnapshot['cards'] = [];

  if (dashboardId) {
    const dash = await deps.getDashboard(dashboardId);
    await deps.assertAccess(dash, schedule);
    const cards = dash.cards ?? [];
    for (const card of cards) {
      const data = await deps.resolveCard(card, dash, schedule.ownerId);
      cardsOut.push({
        cardId: card.id,
        type:   card.type,
        title:  card.title ?? null,
        data:   JSON.parse(JSON.stringify(data ?? null)),   // deep-freeze via clone
      });
    }
  }

  return {
    scheduleId:  schedule.id,
    dashboardId,
    periodKey,
    generatedAt: new Date().toISOString(),
    cards: cardsOut,
  };
}

export interface RunDueDeps {
  snapshot:  (schedule: ScheduledReport, periodKey: string) => Promise<ReportSnapshot>;
  recordRun: (p: { scheduledReportId: string; periodKey: string; status: 'delivered' | 'failed' | 'skipped'; snapshotRef: string | null; error: string | null }) => Promise<{ inserted: boolean; run: ScheduledReportRun | null }>;
  deliver:   (schedule: ScheduledReport, run: ScheduledReportRun) => Promise<void>;
  advance:   (id: string, nextRunAt: Date | null) => Promise<unknown>;
}

/**
 * Run ONE due occurrence: snapshot → recordRun (idempotent per period) → deliver
 * ONLY when inserted=true (a duplicate means a worker restart re-attempt → skip) →
 * advance NextRunAt (or null → disabled at cadence end). Advances regardless so the
 * sweep moves past a failed period.
 */
export async function runDueWith(schedule: ScheduledReport, now: Date, deps: RunDueDeps): Promise<{ delivered: boolean }> {
  const occurrence = schedule.nextRunAt ? new Date(schedule.nextRunAt) : now;
  const periodKey  = periodKeyFor(occurrence);

  let delivered = false;
  try {
    const snap = await deps.snapshot(schedule, periodKey);
    const { inserted, run } = await deps.recordRun({
      scheduledReportId: schedule.id,
      periodKey,
      status:      'delivered',
      snapshotRef: JSON.stringify(snap),
      error:       null,
    });
    if (inserted && run) {
      await deps.deliver(schedule, run);
      delivered = true;
    }
  } catch (err: any) {
    log.error({ err: err?.message, scheduledReportId: schedule.id, periodKey }, 'runDue failed — recording a failed run');
    // Record a 'failed' run for the audit trail; if THAT write also fails, log it
    // (don't bare-swallow) so a transient DB blip on the failure path is visible.
    await deps.recordRun({ scheduledReportId: schedule.id, periodKey, status: 'failed', snapshotRef: null, error: String(err?.message ?? err) })
      .catch((e2: any) => log.error({ err: e2?.message, scheduledReportId: schedule.id, periodKey }, 'failed-run record also failed'));
  }

  const next = computeNextRun(schedule.cadence as RecurrenceRuleShape, occurrence);
  await deps.advance(schedule.id, next);
  return { delivered };
}

// ── Service (binds the cores to the real repository + 9a services) ───────────

export class ScheduledReportService {
  constructor(private repo: ScheduledReportRepository = scheduledReportRepository) {}

  getById(id: string): Promise<ScheduledReport | null> { return this.repo.getById(id); }
  listByWorkspace(workspaceId: string): Promise<ScheduledReport[]> { return this.repo.listByWorkspace(workspaceId); }
  listRuns(id: string, page = 1, pageSize = 20) { return this.repo.listRuns(id, page, pageSize); }
  listDue(now: Date): Promise<ScheduledReport[]> { return this.repo.listDue(now); }

  async create(input: CreateScheduledReportInput, ownerId: string): Promise<ScheduledReport> {
    const cadence = this.validateCadence(input.cadence);
    // C1: bind the dashboard to the schedule's workspace + assert the owner can
    // actually VIEW it. Without this a manage-holder in workspace A could point a
    // schedule at workspace B's dashboard (or a space they can't see) and the
    // owner-scoped snapshot would resolve it (runConfig trusts the caller).
    if (input.dashboardId) {
      const dash = await dashboardService.getWithCards(input.dashboardId);
      await assertDashboardSnapshotAccess(dash, input.workspaceId, ownerId);
    }
    // I1: recipients must be members of the schedule's workspace — owner-resolved
    // data is delivered (verbatim) into each recipient's inbox.
    await this.assertRecipientsAreMembers(input.workspaceId, input.recipients ?? []);

    const firstRun = computeNextRun(cadence, new Date());
    return this.repo.create({
      workspaceId:     input.workspaceId,
      dashboardId:     input.dashboardId ?? null,
      reportKind:      input.reportKind ?? null,
      reportParams:    input.reportParams ? JSON.stringify(input.reportParams) : null,
      cadence:         JSON.stringify(cadence),
      deliveryChannel: input.deliveryChannel ?? 'inbox',
      recipients:      JSON.stringify(input.recipients ?? []),
      nextRunAt:       firstRun,
      ownerId,
    });
  }

  async update(id: string, input: UpdateScheduledReportInput): Promise<ScheduledReport | null> {
    let nextRunAt: Date | null = null;
    let cadenceJson: string | null = null;
    if (input.cadence) {
      const cadence = this.validateCadence(input.cadence);
      cadenceJson = JSON.stringify(cadence);
      nextRunAt = computeNextRun(cadence, new Date());   // re-seed on a cadence change
    }
    if (input.recipients) {
      const existing = await this.repo.getById(id);
      if (existing) await this.assertRecipientsAreMembers(existing.workspaceId, input.recipients);
    }
    return this.repo.update(id, {
      cadence:         cadenceJson,
      deliveryChannel: input.deliveryChannel ?? null,
      recipients:      input.recipients ? JSON.stringify(input.recipients) : null,
      enabled:         input.enabled ?? null,
      nextRunAt,
    });
  }

  delete(id: string): Promise<number> { return this.repo.delete(id); }

  /** Snapshot bound to the real 9a services (owner-scoped card resolve, fail-closed
   *  object-level gate). */
  snapshot(schedule: ScheduledReport, periodKey: string): Promise<ReportSnapshot> {
    return snapshotWith(schedule, periodKey, {
      getDashboard: (dashId) => dashboardService.getWithCards(dashId),
      assertAccess: (dash, s) => assertDashboardSnapshotAccess(dash, s.workspaceId, s.ownerId),
      resolveCard:  (card, dash, userId) => cardService.resolve(card, dash, userId),
    });
  }

  /** Run one due schedule bound to the real repository + delivery adapter. */
  runDue(schedule: ScheduledReport, now: Date): Promise<{ delivered: boolean }> {
    return runDueWith(schedule, now, {
      snapshot:  (s, pk) => this.snapshot(s, pk),
      recordRun: (p) => this.repo.recordRun(p),
      deliver:   (s, run) => deliverFor(s, run),
      advance:   (id, next) => this.repo.advance(id, next),
    });
  }

  private async assertRecipientsAreMembers(workspaceId: string, recipients: string[]): Promise<void> {
    for (const userId of recipients) {
      if (!(await isWorkspaceMember(workspaceId, userId))) {
        throw new RecipientNotMemberError(`recipient ${userId} is not a member of the workspace`);
      }
    }
  }

  private validateCadence(raw: unknown): RecurrenceRuleShape {
    try { return validateRule(raw); }
    catch (err: any) { throw new InvalidCadenceError(err?.message ?? 'invalid cadence'); }
  }
}

export const scheduledReportService = new ScheduledReportService();
