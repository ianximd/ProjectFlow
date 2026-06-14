import { notificationService } from '../notifications/notification.service.js';
import { isWorkspaceMember } from '../workspaces/membership.js';
import { subLogger } from '../../shared/lib/logger.js';
import type { DeliveryChannel, ScheduledReport, ScheduledReportRun } from '@projectflow/types';

const log = subLogger('scheduled-report-delivery');

export interface DeliveryAdapter {
  deliver(schedule: ScheduledReport, run: ScheduledReportRun): Promise<void>;
}

/**
 * Inbox channel — the only LIVE channel in Phase 9. Creates one in-app
 * "report ready" notification per recipient via the Phase 3.5 fan-out, carrying
 * the schedule + run + the frozen snapshot in the payload (so a member recipient
 * who does NOT hold scheduled_report.manage — and is therefore 403'd from the
 * snapshot viewer route — still sees the report they were sent).
 *
 * Defense-in-depth: deliver ONLY to CURRENT members of the schedule's workspace.
 * create/update already reject non-member recipients, but a recipient could have
 * been removed from the workspace since — owner-resolved data must never land in
 * a non-member's inbox.
 */
const inboxAdapter: DeliveryAdapter = {
  async deliver(schedule, run) {
    const members: string[] = [];
    for (const uid of schedule.recipients) {
      if (await isWorkspaceMember(schedule.workspaceId, uid)) members.push(uid);
    }
    if (members.length === 0) {
      log.warn({ scheduledReportId: schedule.id, runId: run.id }, 'no current members among recipients — nothing delivered');
      return;
    }
    await notificationService.notify({
      recipientIds: members,
      actorId:      schedule.ownerId,
      type:         'SCHEDULED_REPORT_READY',
      payload: {
        scheduledReportId: schedule.id,
        runId:             run.id,
        dashboardId:       schedule.dashboardId,
        periodKey:         run.periodKey,
        snapshotRef:       run.snapshotRef,
      },
    });
  },
};

/**
 * Email channel — DEFERRED to Phase 12 (no SMTP infra yet). Explicit no-op STUB
 * behind DeliveryChannel='email': it logs and returns so a schedule configured for
 * email still records a run without throwing. Phase 12 replaces the body with real
 * SMTP send; the column + this seam already exist.
 */
const emailAdapter: DeliveryAdapter = {
  async deliver(schedule, run) {
    log.info(
      { scheduledReportId: schedule.id, runId: run.id, recipients: schedule.recipients.length },
      'email delivery is a no-op stub (deferred to Phase 12) — recording the run only',
    );
  },
};

const ADAPTERS: Record<DeliveryChannel, DeliveryAdapter> = {
  inbox: inboxAdapter,
  email: emailAdapter,
};

export function deliverFor(schedule: ScheduledReport, run: ScheduledReportRun): Promise<void> {
  return ADAPTERS[schedule.deliveryChannel].deliver(schedule, run);
}
