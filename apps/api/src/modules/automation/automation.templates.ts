import type {
  AutomationTemplate,
  AutomationTriggerConfig,
  AutomationCondition,
  AutomationAction,
} from '@projectflow/types';

/** Catalog version — bump when the set changes (telemetry/debug only). */
export const TEMPLATE_CATALOG_VERSION = 1;

type Def = {
  key: string;
  trigger: AutomationTriggerConfig;
  conditions: AutomationCondition[];
  actions: AutomationAction[];
};

// ── The 18 prebuilt definitions (BUILD_PLAN §7.6: 15–20) ──────────────────────
const DEFS: Def[] = [
  {
    key: 'auto-assign-on-create',
    trigger: { type: 'TASK_CREATED' } as any,
    conditions: [],
    actions: [{ type: 'ASSIGN', assigneeId: 'REPORTER' } as any],
  },
  {
    key: 'move-to-in-progress-on-assign',
    trigger: { type: 'ASSIGNEE_CHANGED' } as any,
    conditions: [{ type: 'FIELD_EQUALS', field: 'assignee', operator: 'is_set' } as any],
    actions: [{ type: 'CHANGE_STATUS', toStatus: 'In Progress' } as any],
  },
  {
    key: 'comment-notify-on-blocker',
    trigger: { type: 'FIELD_CHANGED', field: 'tags' } as any,
    conditions: [{ type: 'FIELD_EQUALS', field: 'tag', operator: 'is', value: 'blocked' } as any],
    actions: [
      { type: 'POST_COMMENT', message: 'This task was marked blocked — please review.' } as any,
      { type: 'SEND_NOTIFICATION', message: 'A task you watch is now blocked.' } as any,
    ],
  },
  {
    key: 'nudge-assignee-on-overdue',
    trigger: { type: 'DUE_DATE_PASSED' } as any,
    conditions: [{ type: 'FIELD_NOT_EQUALS', field: 'status', operator: 'is_not', value: 'Done' } as any],
    actions: [{ type: 'SEND_NOTIFICATION', message: 'A task assigned to you is overdue.' } as any],
  },
  {
    key: 'close-stale-after-days',
    trigger: { type: 'SCHEDULED', cron: '0 2 * * *' } as any,
    conditions: [{ type: 'ISSUE_MATCHES_FILTER', pql: 'updated < -14d AND status != "Done"' } as any],
    actions: [{ type: 'CHANGE_STATUS', toStatus: 'Closed' } as any],
  },
  {
    key: 'set-priority-on-label',
    trigger: { type: 'FIELD_CHANGED', field: 'tags' } as any,
    conditions: [{ type: 'FIELD_EQUALS', field: 'tag', operator: 'is', value: 'urgent' } as any],
    actions: [{ type: 'SET_PRIORITY', priority: 'HIGHEST' } as any],
  },
  {
    key: 'webhook-on-done',
    trigger: { type: 'STATUS_CHANGED', toStatus: 'Done' } as any,
    conditions: [],
    actions: [{ type: 'CALL_WEBHOOK', webhookEvent: 'automation.fired' } as any],
  },
  {
    key: 'follow-up-subtask-on-done',
    trigger: { type: 'STATUS_CHANGED', toStatus: 'Done' } as any,
    conditions: [],
    actions: [{ type: 'CREATE_SUBTASK', title: 'Follow-up review' } as any],
  },
  {
    key: 'apply-checklist-on-create',
    trigger: { type: 'TASK_CREATED' } as any,
    conditions: [{ type: 'FIELD_EQUALS', field: 'type', operator: 'is', value: 'Bug' } as any],
    actions: [{ type: 'APPLY_TEMPLATE', templateId: '' } as any],
  },
  {
    key: 'notify-watchers-on-status',
    trigger: { type: 'STATUS_CHANGED' } as any,
    conditions: [],
    actions: [{ type: 'SEND_NOTIFICATION', message: 'Status changed on a task you watch.' } as any],
  },
  {
    key: 'escalate-priority-on-overdue',
    trigger: { type: 'DUE_DATE_PASSED' } as any,
    conditions: [{ type: 'FIELD_EQUALS', field: 'priority', operator: 'is', value: 'MEDIUM' } as any],
    actions: [{ type: 'SET_PRIORITY', priority: 'HIGH' } as any],
  },
  {
    key: 'archive-on-closed',
    trigger: { type: 'STATUS_CHANGED', toStatus: 'Closed' } as any,
    conditions: [],
    actions: [{ type: 'ADD_TAG', tagName: 'archived' } as any],
  },
  {
    key: 'tag-on-high-priority-create',
    trigger: { type: 'TASK_CREATED' } as any,
    conditions: [{ type: 'FIELD_EQUALS', field: 'priority', operator: 'is', value: 'HIGHEST' } as any],
    actions: [{ type: 'ADD_TAG', tagName: 'critical' } as any],
  },
  {
    key: 'reassign-to-reporter-on-reopen',
    trigger: { type: 'STATUS_CHANGED', toStatus: 'Reopened' } as any,
    conditions: [],
    actions: [{ type: 'ASSIGN', assigneeId: 'REPORTER' } as any],
  },
  {
    key: 'thank-on-comment',
    trigger: { type: 'COMMENT_POSTED' } as any,
    conditions: [{ type: 'FIELD_EQUALS', field: 'status', operator: 'is', value: 'Done' } as any],
    actions: [{ type: 'SEND_NOTIFICATION', message: 'New comment on a completed task.' } as any],
  },
  {
    key: 'unassign-on-backlog',
    trigger: { type: 'STATUS_CHANGED', toStatus: 'Backlog' } as any,
    conditions: [],
    actions: [{ type: 'UNASSIGN' } as any],
  },
  {
    key: 'sprint-rollover-housekeeping',
    trigger: { type: 'SPRINT_COMPLETED' } as any,
    conditions: [{ type: 'NOT_IN_SPRINT' } as any],
    actions: [{ type: 'POST_COMMENT', message: 'Sprint completed — unfinished items moved to backlog.' } as any],
  },
  {
    key: 'remind-on-due-date-arrived',
    trigger: { type: 'DATE_ARRIVED' } as any,
    conditions: [{ type: 'FIELD_NOT_EQUALS', field: 'status', operator: 'is_not', value: 'Done' } as any],
    actions: [{ type: 'SEND_NOTIFICATION', message: 'A task is due today.' } as any],
  },
];

type Locale = 'en' | 'id';

/**
 * en/id strings for each template's title + description. Kept beside the catalog
 * so the API can localize GET /templates without coupling to the web messages
 * bundle. The web Automations namespace mirrors these keys so the in-app gallery
 * localizes identically; the unit test asserts parity across BOTH sources.
 */
export const TEMPLATE_STRINGS: Record<Locale, Record<string, { title: string; description: string }>> = {
  en: {
    'auto-assign-on-create':            { title: 'Auto-assign on create',        description: 'Assign every new task to its reporter.' },
    'move-to-in-progress-on-assign':    { title: 'Start work on assign',         description: 'Move a task to In Progress when it gets an assignee.' },
    'comment-notify-on-blocker':        { title: 'Flag blockers',                description: 'Comment and notify when a task is marked blocked.' },
    'nudge-assignee-on-overdue':        { title: 'Nudge on overdue',             description: 'Notify the assignee when a task passes its due date.' },
    'close-stale-after-days':           { title: 'Close stale tasks',            description: 'Close tasks untouched for 14 days (nightly sweep).' },
    'set-priority-on-label':            { title: 'Urgent → highest priority',    description: 'Set priority to Highest when the urgent tag is added.' },
    'webhook-on-done':                  { title: 'Webhook on done',              description: 'POST a signed payload to an external URL when a task is Done.' },
    'follow-up-subtask-on-done':        { title: 'Follow-up subtask on done',    description: 'Create a follow-up review subtask when a task is Done.' },
    'apply-checklist-on-create':        { title: 'Apply checklist to new bugs',  description: 'Apply a saved template to every new Bug.' },
    'notify-watchers-on-status':        { title: 'Notify watchers on status',    description: 'Notify watchers whenever a task changes status.' },
    'escalate-priority-on-overdue':     { title: 'Escalate overdue priority',    description: 'Bump Medium tasks to High when they go overdue.' },
    'archive-on-closed':                { title: 'Archive closed tasks',         description: 'Tag a task archived when it is Closed.' },
    'tag-on-high-priority-create':      { title: 'Tag critical on create',       description: 'Tag new Highest-priority tasks as critical.' },
    'reassign-to-reporter-on-reopen':   { title: 'Reassign on reopen',           description: 'Reassign to the reporter when a task is Reopened.' },
    'thank-on-comment':                 { title: 'Notify on done comments',      description: 'Notify when a comment lands on a completed task.' },
    'unassign-on-backlog':              { title: 'Clear assignee in backlog',    description: 'Unassign a task when it moves to Backlog.' },
    'sprint-rollover-housekeeping':     { title: 'Sprint rollover note',         description: 'Comment housekeeping note when a sprint completes.' },
    'remind-on-due-date-arrived':       { title: 'Remind on due date',           description: 'Notify when a task reaches its due date.' },
  },
  id: {
    'auto-assign-on-create':            { title: 'Tetapkan otomatis saat dibuat', description: 'Tetapkan setiap tugas baru ke pelapornya.' },
    'move-to-in-progress-on-assign':    { title: 'Mulai kerja saat ditugaskan',   description: 'Pindahkan tugas ke Sedang Dikerjakan saat mendapat penerima tugas.' },
    'comment-notify-on-blocker':        { title: 'Tandai penghambat',             description: 'Beri komentar dan beri tahu saat tugas ditandai terhambat.' },
    'nudge-assignee-on-overdue':        { title: 'Ingatkan saat terlambat',       description: 'Beri tahu penerima tugas saat tugas melewati tenggat.' },
    'close-stale-after-days':           { title: 'Tutup tugas mangkrak',          description: 'Tutup tugas yang tidak tersentuh selama 14 hari (sapuan malam).' },
    'set-priority-on-label':            { title: 'Mendesak → prioritas tertinggi', description: 'Atur prioritas ke Tertinggi saat label mendesak ditambahkan.' },
    'webhook-on-done':                  { title: 'Webhook saat selesai',          description: 'Kirim payload bertanda tangan ke URL eksternal saat tugas Selesai.' },
    'follow-up-subtask-on-done':        { title: 'Subtugas tindak lanjut saat selesai', description: 'Buat subtugas tinjauan tindak lanjut saat tugas Selesai.' },
    'apply-checklist-on-create':        { title: 'Terapkan checklist ke bug baru', description: 'Terapkan templat tersimpan ke setiap Bug baru.' },
    'notify-watchers-on-status':        { title: 'Beri tahu pengamat saat status berubah', description: 'Beri tahu pengamat setiap kali tugas berganti status.' },
    'escalate-priority-on-overdue':     { title: 'Eskalasi prioritas terlambat',  description: 'Naikkan tugas Sedang ke Tinggi saat terlambat.' },
    'archive-on-closed':                { title: 'Arsipkan tugas tertutup',       description: 'Tandai tugas diarsipkan saat Ditutup.' },
    'tag-on-high-priority-create':      { title: 'Tandai kritis saat dibuat',     description: 'Tandai tugas prioritas Tertinggi baru sebagai kritis.' },
    'reassign-to-reporter-on-reopen':   { title: 'Tetapkan ulang saat dibuka kembali', description: 'Tetapkan ke pelapor saat tugas Dibuka Kembali.' },
    'thank-on-comment':                 { title: 'Beri tahu komentar pada tugas selesai', description: 'Beri tahu saat komentar masuk pada tugas selesai.' },
    'unassign-on-backlog':              { title: 'Kosongkan penerima di backlog',  description: 'Lepas penerima tugas saat pindah ke Backlog.' },
    'sprint-rollover-housekeeping':     { title: 'Catatan rollover sprint',       description: 'Beri komentar catatan rapi saat sprint selesai.' },
    'remind-on-due-date-arrived':       { title: 'Ingatkan saat tenggat tiba',    description: 'Beri tahu saat tugas mencapai tenggatnya.' },
  },
};

/** Dotted i18n keys under the web Automations namespace (en/id mirror these). */
function camel(k: string): string { return k.replace(/-([a-z])/g, (_, c) => c.toUpperCase()); }
function titleKey(key: string): string { return `tpl_${camel(key)}_title`; }
function descKey(key: string):  string { return `tpl_${camel(key)}_desc`; }

/** The raw catalog (i18n keys attached; strings filled by getTemplateCatalog). */
export const AUTOMATION_TEMPLATES: AutomationTemplate[] = DEFS.map((d) => ({
  key:          d.key,
  i18nTitleKey: titleKey(d.key),
  i18nDescKey:  descKey(d.key),
  trigger:      d.trigger,
  conditions:   d.conditions,
  actions:      d.actions,
}));

/** Localize the catalog for a request locale (defaults to en). */
export function getTemplateCatalog(locale: string): AutomationTemplate[] {
  const loc: Locale = locale === 'id' ? 'id' : 'en';
  return AUTOMATION_TEMPLATES.map((t) => {
    const s = TEMPLATE_STRINGS[loc][t.key] ?? TEMPLATE_STRINGS.en[t.key];
    return { ...t, title: s?.title ?? t.key, description: s?.description ?? '' };
  });
}
