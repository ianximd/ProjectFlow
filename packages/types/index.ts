export interface User {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  passwordHash: string | null;
  isEmailVerified: boolean;
  mfaEnabled: boolean;
  mfaSecret: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  avatarUrl: string | null;
  ownerId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Project {
  id: string;
  workspaceId: string;
  name: string;
  key: string;
  description: string | null;
  avatarUrl: string | null;
  type: "SCRUM" | "KANBAN" | "BUSINESS";
  status: "ACTIVE" | "ARCHIVED" | "DELETED";
  startDate: Date | null;
  endDate: Date | null;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
}

export enum IssueType { EPIC = 'EPIC', STORY = 'STORY', TASK = 'TASK', BUG = 'BUG', SUBTASK = 'SUBTASK', IMPROVEMENT = 'IMPROVEMENT', FEATURE = 'FEATURE', TEST = 'TEST' }
export enum Priority  { HIGHEST = 'HIGHEST', HIGH = 'HIGH', MEDIUM = 'MEDIUM', LOW = 'LOW', LOWEST = 'LOWEST' }

export interface Task {
  id: string;
  projectId: string;
  workspaceId: string;
  issueKey: string;
  title: string;
  description: string | null;
  type: IssueType;
  status: string;
  priority: Priority;
  assigneeIds: string[];
  reporterId: string;
  sprintId: string | null;
  epicId: string | null;
  parentTaskId: string | null;
  storyPoints: number | null;
  startDate: Date | null;
  dueDate: Date | null;
  position: number;
  labels: string[];
  versionIds: string[];
  componentIds: string[];
  customFields: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  resolvedAt: Date | null;
  deletedAt: Date | null;
  // ── Hierarchy (Phase 1, migration 0029) ──
  listId: string | null;
  listPath: string | null;
  archivedAt: Date | null;
}

// ─── Hierarchy (Phase 1) ──────────────────────────────────────────────────
export type Visibility = 'PUBLIC' | 'PRIVATE';
export type ObjectPermissionLevel = 'VIEW' | 'COMMENT' | 'EDIT' | 'FULL';
export type HierarchyNodeType = 'SPACE' | 'FOLDER' | 'LIST';

export interface Folder {
  id: string;
  workspaceId: string;
  spaceId: string;
  parentFolderId: string | null;
  name: string;
  position: number;
  path: string;
  workflowId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface List {
  id: string;
  workspaceId: string;
  spaceId: string;
  folderId: string | null;
  name: string;
  position: number;
  path: string;
  workflowId: string | null;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

/** "Space" is the API/UI label for the physical Projects table. */
export interface SpaceExtras {
  visibility: Visibility;
  maxSubtaskDepth: number | null;
  multipleAssignees: boolean;   // Phase 2
}

export interface CreateTaskInput {
  // Optional since hierarchy Phase 1: when listId is supplied the API derives
  // the Space (bridge projectId). Callers must provide projectId OR listId.
  projectId?: string;
  workspaceId: string;
  title: string;
  description?: string | null;
  type?: string;
  priority?: string;
  reporterId: string;
  sprintId?: string | null;
  storyPoints?: number | null;
  dueDate?: string | Date | null;
  // ── Hierarchy (Phase 1): create directly into a List; optional parent for subtasks ──
  listId?: string | null;
  parentTaskId?: string | null;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string | null;
  type?: string;
  priority?: string;
  sprintId?: string | null;
  epicId?: string | null;
  storyPoints?: number | null;
  startDate?: string | Date | null;
  dueDate?: string | Date | null;
}

export interface TaskFilters {
  projectId: string;
  status?: string;
  assigneeId?: string;
  sprintId?: string;
  priority?: string;
  page?: number;
  pageSize?: number;
}

export interface CommentReactionSummary {
  emoji: string;
  count: number;
}

export interface Comment {
  id: string;
  taskId: string;
  authorId: string;
  parentId: string | null;
  body: string;
  isEdited: boolean;
  assignedToId: string | null;
  resolvedAt: Date | null;
  resolvedById: string | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  // joined fields
  authorName: string;
  authorEmail: string;
  authorAvatarUrl: string | null;
  reactions?: CommentReactionSummary[];
}

export interface CreateCommentInput {
  taskId: string;
  body: string;
  parentId?: string | null;
}

export interface Attachment {
  id: string;
  taskId: string;
  uploadedById: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  storageKey: string;
  bucketName: string;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  // joined fields
  uploaderName: string;
  uploaderAvatarUrl: string | null;
}

export interface Notification {
  id: string;
  userId: string;
  type: string;
  payload: Record<string, any>;
  isRead: boolean;
  createdAt: Date;
}

export interface SearchTask {
  id: string;
  issueKey: string;
  title: string;
  type: string;
  status: string;
  priority: string;
  storyPoints: number | null;
  dueDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
  projectId: string;
  projectName: string;
  projectKey: string;
  sprintId: string | null;
  reporterId: string;
}

export interface RoadmapAssignee {
  id: string;
  name: string;
  avatarUrl: string | null;
}

export interface RoadmapItem {
  id: string;
  issueKey: string;
  title: string;
  type: string;
  status: string;
  priority: string;
  startDate: string | null;
  dueDate: string | null;
  epicId: string | null;
  parentTaskId: string | null;
  storyPoints: number | null;
  projectId: string;
  projectName: string;
  projectKey: string;
  assignees: RoadmapAssignee[];
  childCount: number;
  childDoneCount: number;
}

export interface TaskDependency {
  taskId: string;
  dependsOn: string;
  type: string;
}

// ─── Dependencies (Phase 5a) ──────────────────────────────────────────────
// The legacy `TaskDependency` above is the raw edge row. Phase 5a exposes a
// display-oriented view (joined task title/status) plus the waiting-on/blocking
// pair. `TaskDependencyRef` is named distinctly to avoid colliding with the
// legacy `TaskDependency` interface.
export type DependencyRelation = 'waiting_on' | 'blocking';

export interface TaskDependencyRef {
  taskId: string;
  title: string;
  status: string;
  issueKey?: string | null;
}

export interface TaskDependencyLists {
  waitingOn: TaskDependencyRef[]; // tasks this task waits on (blockers)
  blocking: TaskDependencyRef[];  // tasks blocked by this task
}

// Ordered left-to-right as they appear on a kanban board.
// IDEA = pre-commit brainstorm/discovery; TESTING = QA gate before DONE.
// DB column has no CHECK constraint, so adding values is forward-compatible —
// existing rows keep working and old clients fall back to the TODO accent.
export type WorkflowStatusCategory = 'IDEA' | 'TODO' | 'IN_PROGRESS' | 'TESTING' | 'DONE';

export interface WorkflowStatus {
  id: string;
  workflowId: string;
  name: string;
  category: WorkflowStatusCategory;
  color: string;
  position: number;
  createdAt: Date;
}

export interface WorkflowTransition {
  id: string;
  workflowId: string;
  fromStatus: string;
  toStatus: string;
  name: string | null;
  createdAt: Date;
}

export interface Workflow {
  id: string;
  projectId: string;
  name: string;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
  statuses: WorkflowStatus[];
  transitions: WorkflowTransition[];
}

// ── Reports ──────────────────────────────────────────────────────────────────

export interface BurndownPoint {
  date: string | null;
  remainingPoints: number;
  idealPoints: number;
}

export interface BurndownReport {
  totalPoints: number;
  startDate: string | null;
  endDate: string | null;
  points: BurndownPoint[];
}

export interface VelocityEntry {
  sprintId: string;
  sprintName: string;
  startDate: string | null;
  endDate: string | null;
  committedPoints: number;
  completedPoints: number;
}

export interface SprintStatusBreakdown {
  status: string;
  issueCount: number;
  storyPoints: number;
}

export interface SprintSummaryReport {
  sprintId: string;
  sprintName: string;
  startDate: string | null;
  endDate: string | null;
  totalIssues: number;
  completedIssues: number;
  incompleteIssues: number;
  totalPoints: number;
  completedPoints: number;
  statusBreakdown: SprintStatusBreakdown[];
}

// ── Phase 8c: sprint-folder hierarchy ───────────────────────────────────────
export interface Sprint {
  id: string;
  projectId: string;
  listId: string | null;
  folderId: string | null;
  name: string;
  goal: string | null;
  status: 'PLANNED' | 'ACTIVE' | 'COMPLETED';
  startDate: string | null;
  endDate: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SprintSettings {
  folderId: string;
  durationDays: number;
  startDayOfWeek: number | null;   // 0=Sun..6=Sat; null = anchor to prior EndDate
  autoStart: boolean;
  autoComplete: boolean;
  autoRollForward: boolean;
  pointsFieldId: string | null;
  isSprintFolder?: boolean;        // surfaced by usp_Folder_GetSprintSettings
}

export interface SprintAssigneePoints {
  userId: string;
  userName: string | null;
  points: number;
}

export interface SprintPointsRollup {
  total: { totalPoints: number; completedPoints: number };
  perAssignee: SprintAssigneePoints[];
}

export interface WorkloadEntry {
  assigneeId: string;
  assigneeName: string;
  totalIssues: number;
  openIssues: number;
  doneIssues: number;
  totalPoints: number;
  openPoints: number;
}

export interface CreatedVsResolvedEntry {
  weekStart: string | null;
  weekEnd: string | null;
  created: number;
  resolved: number;
}

// ── Automation Engine ─────────────────────────────────────────────────────────

export type AutomationScopeType = 'WORKSPACE' | 'PROJECT';

export type AutomationTriggerType =
  | 'TASK_CREATED'
  | 'TASK_UPDATED'
  | 'STATUS_CHANGED'
  | 'FIELD_CHANGED'
  | 'ASSIGNEE_CHANGED'
  | 'COMMENT_POSTED'
  | 'SPRINT_STARTED'
  | 'SPRINT_COMPLETED'
  | 'DUE_DATE_PASSED'
  | 'DATE_ARRIVED'
  | 'SCHEDULED'
  | 'MANUAL'
  | 'WEBHOOK';

export interface AutomationTriggerConfig {
  type: AutomationTriggerType;
  /** For SCHEDULED: cron expression */
  cron?: string;
  /** For STATUS_CHANGED: only fire when moving to this status */
  toStatus?: string;
  /** For FIELD_CHANGED: only fire when this field changed */
  field?: string;
  /** For DUE_DATE_PASSED: hours before due date (preserves "approaching" semantics) */
  hoursBeforeDue?: number;
}

export type AutomationConditionType =
  | 'ISSUE_MATCHES_FILTER'
  | 'FIELD_EQUALS'
  | 'FIELD_NOT_EQUALS'
  | 'USER_HAS_ROLE'
  | 'IN_SPRINT'
  | 'NOT_IN_SPRINT';

export interface AutomationCondition {
  type: AutomationConditionType;
  field?: string;
  value?: string;
  pql?: string;
}

// ── Recursive condition tree (Phase 6b) ───────────────────────────────────────
// A rule's conditions are now a recursive AND/OR group of leaves. A legacy flat
// AutomationCondition[] is read as an implicit top-level AND group (no migration).

export type ConditionGroupOp = 'AND' | 'OR';

export type ConditionOperator =
  | 'is'
  | 'is_not'
  | 'contains'
  | 'gt'
  | 'lt'
  | 'before'
  | 'after'
  | 'is_set';

/** A single comparison. `type` carries the legacy condition kind; FIELD-style
 *  leaves use `field`/`operator`/`value`, while ISSUE_MATCHES_FILTER uses `pql`
 *  and USER_HAS_ROLE uses `value` (the role slug). */
export interface ConditionLeaf {
  type:     AutomationConditionType;
  field?:   string;
  operator: ConditionOperator;
  value?:   string;
  /** ISSUE_MATCHES_FILTER only. */
  pql?:     string;
}

export interface ConditionGroup {
  op:       ConditionGroupOp;
  children: ConditionNode[];
}

export type ConditionNode = ConditionGroup | ConditionLeaf;

/** Type guard: a group node has an `op` + `children`. */
export function isConditionGroup(node: ConditionNode): node is ConditionGroup {
  return (node as ConditionGroup).op === 'AND' || (node as ConditionGroup).op === 'OR';
}

export type AutomationActionType =
  | 'CHANGE_STATUS'
  | 'ASSIGN'
  | 'UNASSIGN'
  | 'SET_PRIORITY'
  | 'POST_COMMENT'
  | 'SEND_NOTIFICATION'
  | 'CALL_WEBHOOK'
  | 'SET_FIELD'
  | 'ADD_TAG'
  | 'CREATE_TASK'
  | 'CREATE_SUBTASK'
  | 'MOVE_TASK'
  | 'APPLY_TEMPLATE';

export interface AutomationAction {
  type: AutomationActionType;
  /** CHANGE_STATUS */
  toStatus?: string;
  /** ASSIGN: userId or "REPORTER" */
  assigneeId?: string;
  /** SET_PRIORITY */
  priority?: string;
  /** POST_COMMENT / SEND_NOTIFICATION */
  message?: string;
  /** CALL_WEBHOOK (legacy, kept) */
  webhookUrl?: string;
  /** CALL_WEBHOOK (6c — selects a workspace outgoing-webhook event) */
  webhookEvent?: string;
  // ── Phase 6c ──
  /** SET_FIELD */
  fieldId?: string;
  fieldValue?: unknown;
  /** ADD_TAG */
  tagId?: string;
  tagName?: string;
  /** CREATE_TASK / CREATE_SUBTASK */
  title?: string;
  description?: string;
  newPriority?: string;
  /** MOVE_TASK */
  targetListId?: string;
  targetPosition?: number;
  /** APPLY_TEMPLATE */
  templateId?: string;
  /** Universal optional per-action delay */
  delaySeconds?: number;
}

export interface AutomationRule {
  id: string;
  scopeType: AutomationScopeType;
  workspaceId: string;
  projectId: string | null;
  name: string;
  isEnabled: boolean;
  trigger: AutomationTriggerConfig;
  /** Legacy flat array OR a recursive AND/OR tree (Phase 6b). Read via
   *  parseConditionTree() which normalises a flat array to an implicit AND. */
  conditions: AutomationCondition[] | ConditionNode;
  actions: AutomationAction[];
  executionCount: number;
  lastExecutedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type AutomationRunStatus = 'success' | 'partial' | 'failed' | 'skipped' | 'loop_blocked';

export interface AutomationRun {
  id: string;
  ruleId: string;
  workspaceId: string;
  projectId: string | null;
  triggerType: string;
  status: AutomationRunStatus;
  payload: unknown | null;
  actionResults: unknown | null;
  error: string | null;
  depth: number;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
}

// ── Automation Templates / Metering (Phase 6d) ────────────────────────────────
// Run history (AutomationRun above) already ships from Phase 6a; 6d adds the
// in-code template catalog and read-only per-workspace metering.

/**
 * An in-code template definition. The gallery pre-fills the rule builder from
 * `trigger`/`conditions`/`actions`; `i18nTitleKey`/`i18nDescKey` resolve to the
 * localized card title/description. No tenant rows are seeded.
 */
export interface AutomationTemplate {
  key:          string;                  // stable catalog id, e.g. 'auto-assign-on-create'
  i18nTitleKey: string;                  // dotted key under the Automations namespace
  i18nDescKey:  string;
  /** Server-localized strings (filled by GET /templates for the request locale). */
  title?:       string;
  description?: string;
  trigger:      AutomationTriggerConfig;
  conditions:   AutomationCondition[] | ConditionNode;
  actions:      AutomationAction[];
}

/** Read-only per-workspace metering for the current period (no enforcement). */
export interface AutomationUsage {
  workspaceId: string;
  period:      string;                  // 'YYYYMM'
  runCount:    number;
}

// ── Time Tracking / Work Logs ─────────────────────────────────────────────────

export interface WorkLogUser {
  id:        string;
  name:      string;
  avatarUrl: string | null;
}

export type WorkLogSource = 'manual' | 'range' | 'timer';

export interface WorkLogTag {
  id:    string;
  name:  string;
  color: string | null;
}

export interface WorkLog {
  id:               string;
  taskId:           string;
  user:             WorkLogUser;
  timeSpentSeconds: number;
  startedAt:        string;
  endedAt:          string | null;
  description:      string | null;
  billable:         boolean;
  source:           WorkLogSource;
  createdAt:        string;
  tags?:            WorkLogTag[];
}

export interface WorkLogTotals {
  user:         WorkLogUser;
  totalSeconds: number;
}

export interface WorkLogListResult {
  logs:   WorkLog[];
  totals: WorkLogTotals[];
}

/** The caller's currently-running timer, or null when none is active. */
export interface ActiveTimer {
  log: WorkLog | null;
}

/** Own + subtree-rolled time aggregates for a task (logged & estimated). */
export interface TaskTimeRollup {
  taskId:                string;
  ownLoggedSeconds:      number;
  ownEstimateSeconds:    number | null;
  rollupLoggedSeconds:   number;
  rollupEstimateSeconds: number;
}

export interface CreateWorkLogInput {
  taskId:           string;
  timeSpentSeconds: number;
  startedAt:        string;
  description?:     string;
  endedAt?:         string;
  billable?:        boolean;
  source?:          WorkLogSource;
  tagIds?:          string[];
}

export interface UpdateWorkLogInput {
  timeSpentSeconds?: number;
  startedAt?:        string;
  description?:      string;
  endedAt?:          string;
  billable?:         boolean;
  tagIds?:           string[];
}

// ── Timesheets (Phase 8b) ─────────────────────────────────────────────────────

export type TimesheetStatus = 'draft' | 'submitted' | 'approved' | 'rejected';

export interface Timesheet {
  id:           string;
  workspaceId:  string;
  userId:       string;
  periodStart:  string;   // ISO date (YYYY-MM-DD)
  periodEnd:    string;   // ISO date (YYYY-MM-DD)
  status:       TimesheetStatus;
  submittedAt:  string | null;
  reviewedById: string | null;
  reviewedAt:   string | null;
  note:         string | null;
  createdAt:    string;
  updatedAt:    string;
}

export interface TimesheetAggregateRow {
  workDate:           string;   // ISO date
  taskId:             string;
  taskTitle:          string;
  totalSeconds:       number;
  billableSeconds:    number;
  nonBillableSeconds: number;
}

export interface TimesheetAggregateTotals {
  totalSeconds:       number;
  billableSeconds:    number;
  nonBillableSeconds: number;
}

export interface TimesheetAggregate {
  rows:   TimesheetAggregateRow[];
  totals: TimesheetAggregateTotals;
}

// ── Versions ──────────────────────────────────────────────────────────────────

export type VersionStatus = 'UNRELEASED' | 'RELEASED' | 'ARCHIVED';

export interface Version {
  id:               string;
  projectId:        string;
  name:             string;
  description:      string | null;
  status:           VersionStatus;
  startDate:        string | null;
  releaseDate:      string | null;
  releasedAt:       string | null;
  createdAt:        string;
  totalIssues:      number;
  completedIssues:  number;
}

export interface CreateVersionInput {
  projectId:    string;
  name:         string;
  description?: string;
  startDate?:   string;
  releaseDate?: string;
}

export interface UpdateVersionInput {
  name?:        string;
  description?: string;
  status?:      VersionStatus;
  startDate?:   string;
  releaseDate?: string;
}

// ── Components ────────────────────────────────────────────────────────────────

export interface ProjectComponent {
  id:             string;
  projectId:      string;
  name:           string;
  description:    string | null;
  leadUserId:     string | null;
  leadUserName:   string | null;
  leadAvatarUrl:  string | null;
  createdAt:      string;
  issueCount:     number;
}

export interface CreateComponentInput {
  projectId:    string;
  name:         string;
  description?: string;
  leadUserId?:  string;
}

export interface UpdateComponentInput {
  name?:        string;
  description?: string;
  leadUserId?:  string;
}

// ── Labels ────────────────────────────────────────────────────────────────────

export interface Label {
  id:         string;
  projectId:  string;
  name:       string;
  color:      string;
  createdAt:  string;
  issueCount: number;
}

export interface CreateLabelInput {
  projectId: string;
  name:      string;
  color?:    string;
}

export interface UpdateLabelInput {
  name?:  string;
  color?: string;
}

// ── Epics ─────────────────────────────────────────────────────────────────────

export interface EpicSummary {
  id:                string;
  issueKey:          string;
  title:             string;
  status:            string;
  priority:          string;
  startDate:         string | null;
  dueDate:           string | null;
  createdAt:         string;
  totalChildren:     number;
  completedChildren: number;
}

// ── Git Integration ───────────────────────────────────────────────────────────

export type GitProvider = 'github' | 'gitlab';

export interface GitConnection {
  id:          string;
  workspaceId: string;
  provider:    GitProvider;
  repoOwner:   string;
  repoName:    string;
  webhookId:   string | null;
  createdAt:   string;
}

export interface CreateGitConnectionInput {
  workspaceId:   string;
  provider:      GitProvider;
  repoOwner:     string;
  repoName:      string;
  webhookSecret: string;
  webhookId?:    string;
}

export type GitPRState = 'open' | 'closed' | 'merged';

export interface GitPullRequest {
  id:              string;
  taskId:          string;
  provider:        GitProvider;
  repoOwner:       string;
  repoName:        string;
  prNumber:        number;
  title:           string;
  url:             string;
  author:          string;
  authorAvatarUrl: string | null;
  state:           GitPRState;
  headBranch:      string;
  baseBranch:      string;
  mergedAt:        string | null;
  createdAt:       string;
  updatedAt:       string;
}

export interface GitCommit {
  id:              string;
  taskId:          string;
  provider:        GitProvider;
  repoOwner:       string;
  repoName:        string;
  commitSha:       string;
  message:         string;
  url:             string;
  author:          string;
  authorAvatarUrl: string | null;
  committedAt:     string;
  createdAt:       string;
}

// ── Slack / MS Teams Integration ─────────────────────────────────────────────

export type IntegrationProvider = 'slack' | 'msteams';

export type IntegrationEvent =
  | 'task.created'
  | 'task.transitioned'
  | 'sprint.started'
  | 'sprint.completed';

export interface IntegrationConnection {
  id:          string;
  workspaceId: string;
  provider:    IntegrationProvider;
  channelName: string;
  webhookUrl:  string;
  events:      IntegrationEvent[];
  isActive:    boolean;
  createdAt:   string;
}

export interface CreateIntegrationInput {
  workspaceId: string;
  provider:    IntegrationProvider;
  channelName: string;
  webhookUrl:  string;
  events?:     IntegrationEvent[];
}

// ── Outgoing Webhooks ─────────────────────────────────────────────────────────

export type OutgoingWebhookEvent =
  | 'issue.created'
  | 'issue.updated'
  | 'issue.deleted'
  | 'sprint.started'
  | 'sprint.completed'
  | 'comment.created'
  | 'member.invited'
  | 'automation.fired';

export interface OutgoingWebhook {
  id:          string;
  workspaceId: string;
  name:        string;
  url:         string;
  events:      OutgoingWebhookEvent[];
  isActive:    boolean;
  createdAt:   string;
  // secret is never returned to clients
}

export interface WebhookDelivery {
  id:          string;
  webhookId:   string;
  event:       string;
  statusCode:  number | null;
  durationMs:  number | null;
  attempt:     number;
  success:     boolean;
  deliveredAt: string;
}

export interface CreateWebhookInput {
  workspaceId: string;
  name:        string;
  url:         string;
  secret:      string;
  events:      OutgoingWebhookEvent[];
}

// ─── Week 22: Admin + Audit Log ───────────────────────────────────────────────

export interface AuditLogEntry {
  id:          string;
  workspaceId: string | null;
  userId:      string;
  userEmail:   string | null;
  action:      string;
  resource:    string;
  resourceId:  string | null;
  oldValues:   Record<string, unknown> | null;
  newValues:   Record<string, unknown> | null;
  ipAddress:   string | null;
  userAgent:   string | null;
  createdAt:   string;
}

export interface AuditLogPage {
  entries:    AuditLogEntry[];
  total:      number;
  page:       number;
  pageSize:   number;
}

export interface AdminStats {
  totalUsers:        number;
  totalWorkspaces:   number;
  totalProjects:     number;
  totalTasks:        number;
  tasksCreatedToday: number;
  loginsLast24h:     number;
  auditEventsToday:  number;
}

export interface AdminUser {
  id:               string;
  email:            string;
  name:             string;
  avatarUrl:        string | null;
  isEmailVerified:  boolean;
  mfaEnabled:       boolean;
  // W43 — populated while the user is in the failed-login lockout window;
  // null otherwise. The admin UI computes a "Locked" status when this
  // is set AND in the future.
  lockedUntil:      string | null;
  workspaceCount:   number;
  createdAt:        string;
  deletedAt:        string | null;
}

/**
 * Operational status of a workspace (Phase 6 W43). Orthogonal to
 * `deletedAt` — an archived workspace still has a Status, but the UI
 * shows "Archived" because soft-delete wins in the badge composer.
 */
export type WorkspaceStatus = 'ACTIVE' | 'TRIAL' | 'FROZEN' | 'SUSPENDED';

export interface AdminWorkspace {
  id:           string;
  name:         string;
  slug:         string;
  avatarUrl:    string | null;
  ownerEmail:   string | null;
  status:       WorkspaceStatus;
  memberCount:  number;
  projectCount: number;
  createdAt:    string;
  deletedAt:    string | null;
}

// ─── RBAC ────────────────────────────────────────────────────────────────────

export type RoleScope = 'SYSTEM' | 'WORKSPACE';

export interface Permission {
  id:          string;
  resource:    string;
  action:      string;
  slug:        string;          // resource.action
  scope:       RoleScope;
  description: string | null;
  createdAt:   string;
}

export interface Role {
  id:          string;
  name:        string;
  slug:        string;
  description: string | null;
  scope:       RoleScope;
  isSystem:    boolean;
  createdAt:   string;
  updatedAt:   string;
}

export interface RoleWithCounts extends Role {
  permissionCount: number;
  memberCount:     number;
}

export interface RoleWithPermissions extends Role {
  permissions: Permission[];
}

export interface UserRoleAssignment {
  userId:        string;
  roleId:        string;
  roleSlug:      string;
  roleName:      string;
  roleScope:     RoleScope;
  roleIsSystem:  boolean;
  workspaceId:   string | null;
  workspaceName: string | null;
  assignedBy:    string | null;
  assignedAt:    string;
}

export interface RoleMember {
  userId:        string;
  email:         string;
  name:          string;
  avatarUrl:     string | null;
  workspaceId:   string | null;
  workspaceName: string | null;
  assignedBy:    string | null;
  assignedAt:    string;
}

// ─── Custom Fields (Phase 2, migration 0030) ──────────────────────────────
export type CustomFieldType =
  | 'text' | 'text_area' | 'number' | 'currency' | 'checkbox' | 'date'
  | 'url' | 'email' | 'phone' | 'dropdown' | 'labels' | 'rating'
  | 'people' | 'progress_manual' | 'progress_auto'
  // Phase 5b: link tasks (relationship) + read-only aggregate over linked tasks (rollup).
  | 'relationship' | 'rollup';

export type RollupFunction = 'sum' | 'avg' | 'count' | 'min' | 'max' | 'first' | 'concat';

export type CustomFieldScopeType = 'SPACE' | 'FOLDER' | 'LIST';

export interface DropdownOption { id: string; name: string; color: string | null; }

/** Discriminated by the owning field's `type`; all members optional on the wire. */
export interface CustomFieldConfig {
  options?: DropdownOption[];   // dropdown, labels
  currencyCode?: string;        // currency (ISO-4217)
  max?: number;                 // rating
  precision?: number;           // number
  includeTime?: boolean;        // date
  source?: 'subtasks';          // progress_auto
  // ── relationship (Phase 5b) ──
  relationshipTargetType?: 'any' | 'list';  // link to any task, or only tasks in a list
  relationshipTargetListId?: string;        // required when relationshipTargetType = 'list'
  // ── rollup (Phase 5b) ──
  rollupRelationshipFieldId?: string;       // a 'relationship' field on the same scope
  rollupSourceField?: FieldRef;             // builtin key or custom field id to aggregate
  rollupFunction?: RollupFunction;          // sum | avg | count | min | max | first | concat
}

/** One linked task as exposed for a `relationship` field's value (the ToTask). */
export interface RelationshipRef {
  taskId: string;
  title: string;
  status: string;
  issueKey?: string | null;
}

// ─── Recurring Tasks (Phase 5c) ───────────────────────────────────────────
// A recurrence rule attached to a task regenerates the next occurrence either
// on completion (DONE-group transition), on a scheduled BullMQ sweep, or both.

export type RecurrenceFreq = 'daily' | 'weekly' | 'monthly' | 'yearly';

/** RRULE-ish recurrence rule (stored as JSON on TaskRecurrences.Rule). */
export interface RecurrenceRule {
  freq: RecurrenceFreq;
  interval: number;          // > 0
  byWeekday?: number[];      // 0=Sun .. 6=Sat (weekly)
  byMonthday?: number;       // 1..31, month-end clamped (monthly/yearly)
  endsAt?: string;           // ISO; no occurrences strictly after this
  count?: number;            // max occurrences to spawn (caller-enforced)
}

export type RecurrenceMode = 'on_complete' | 'schedule' | 'both';

export interface TaskRecurrence {
  id: string;
  taskId: string;
  workspaceId: string;
  rule: RecurrenceRule;
  regenerateMode: RecurrenceMode;
  nextRunAt: string | null;
  active: boolean;
  lastSpawnedTaskId: string | null;
  includeDependencies: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CustomField {
  id: string;
  workspaceId: string;
  scopeType: CustomFieldScopeType;
  scopeId: string;
  scopePath: string;
  type: CustomFieldType;
  name: string;
  config: CustomFieldConfig | null;
  required: boolean;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface TaskCustomFieldValue {
  taskId: string;
  fieldId: string;
  value: unknown;          // JSON-decoded; shape depends on the field type
  updatedAt: string;
}

/** A custom field that applies to a task, joined to its current value (null when unset). */
export interface EffectiveField {
  field: CustomField;
  value: unknown;
}

// ─── Task Types (Phase 2) ─────────────────────────────────────────────────
export interface TaskType {
  id: string;
  workspaceId: string;
  nameSingular: string;
  namePlural: string;
  icon: string | null;
  isMilestone: boolean;
  isDefault: boolean;
  position: number;
  createdAt: string;
  updatedAt: string;
}

// ─── Tags (Phase 2 — alias over Label) ────────────────────────────────────
export type Tag = Label;

// ─── Watchers (Phase 2) ───────────────────────────────────────────────────
export interface TaskWatcher {
  taskId: string;
  userId: string;
  createdAt: string;
}

// ───────────────────────── Views Engine (Phase 3) ─────────────────────────
export type ViewScopeType = 'LIST' | 'FOLDER' | 'SPACE' | 'EVERYTHING';
export type ViewType = 'list' | 'board' | 'table' | 'calendar';

export type FieldRefKind = 'builtin' | 'custom';
export interface FieldRef { kind: FieldRefKind; key: string } // custom key = CustomFields.Id (GUID)

export type FilterOperator =
  | '=' | '!=' | '>' | '>=' | '<' | '<='
  | 'in' | 'not_in' | 'contains' | 'is_empty' | 'is_not_empty';

export interface FilterRule { field: FieldRef; op: FilterOperator; value?: unknown }
export interface FilterGroup { conjunction: 'AND' | 'OR'; rules: Array<FilterRule | FilterGroup> }
export interface SortKey { field: FieldRef; dir: 'ASC' | 'DESC' }

export interface ViewConfig {
  filter: FilterGroup;          // default { conjunction:'AND', rules:[] }
  groupBy?: FieldRef;
  sort: SortKey[];              // default [{ field:{kind:'builtin',key:'position'}, dir:'ASC' }]
  columns?: FieldRef[];
  dateField?: FieldRef;
  meMode?: boolean;
  pageSize?: number;            // default 25
}

export interface SavedView {
  id: string;
  workspaceId: string;
  ownerId: string;
  scopeType: ViewScopeType;
  scopeId: string | null;
  type: ViewType;
  name: string;
  isShared: boolean;
  isDefault: boolean;
  config: ViewConfig;
  position: number;
}

export interface ViewGroup { key: string; label: string; count: number }
export interface ViewTaskPage { tasks: Task[]; total: number; groups?: ViewGroup[] }

export type BulkAction =
  | { kind: 'set_status'; status: string }
  | { kind: 'set_priority'; priority: string }
  | { kind: 'set_assignees'; userIds: string[] }
  | { kind: 'set_custom_field'; fieldId: string; value: unknown }
  | { kind: 'move_to_list'; listId: string }
  | { kind: 'delete' };

export interface BulkUpdateResult { updated: string[]; failed: Array<{ id: string; reason: string }> }

// ─────────────────────────── Templates (Phase 5d) ──────────────────────────
// A template captures a task / list / folder / space subtree as a JSON snapshot
// so it can be re-created later (apply is a separate batch). Every date in the
// snapshot is stored as a day-offset from a reference `anchor`, so apply can
// remap the whole subtree onto a chosen anchor date.
export type TemplateScopeType = 'TASK' | 'LIST' | 'FOLDER' | 'SPACE';

export interface Template {
  id: string;
  workspaceId: string;
  scopeType: TemplateScopeType;
  name: string;
  description?: string | null;
  createdById: string;
  createdAt: string;
  updatedAt?: string;
  deletedAt?: string | null;
}

/** One (field, value) pair captured for a task. `value` is the JSON-decoded
 *  effective value EXACTLY as stored (shape depends on the field type). */
export interface TemplateFieldValue { fieldId: string; value: unknown }

/** A captured saved view (only its portable bits: name/type/config). `config`
 *  is the same ViewConfig the SavedView carries. */
export interface TemplateViewNode { name: string; type: ViewType; config: ViewConfig }

/**
 * A captured task and its subtasks (recursive). `nodeId` is a STABLE path-like
 * id (e.g. `list/0/task/2` or `task/0/sub/1`) so a later "import selected
 * items" UI can address individual nodes. Dates are day-offsets from the
 * snapshot anchor (null when the source date was null). Assignees are dropped
 * by default (user-specific — documented deferral).
 */
export interface TemplateTaskNode {
  nodeId: string;
  title: string;
  description?: string | null;
  type?: string | null;
  priority?: string | null;
  estimate?: number | null;            // storyPoints on the source task
  startOffset?: number | null;
  dueOffset?: number | null;
  customFieldValues: TemplateFieldValue[];
  tags: string[];                       // tag names (portable across spaces)
  subtasks: TemplateTaskNode[];
}

/** A captured list: its settings + custom-field DEFINITIONS + shared views +
 *  tasks. fieldDefs are full CustomField rows (apply re-creates the defs). */
export interface TemplateListNode {
  nodeId: string;
  name: string;
  fieldDefs: CustomField[];
  views: TemplateViewNode[];
  tasks: TemplateTaskNode[];
}

/** A captured folder: nested sub-folders (recursive) + lists. */
export interface TemplateFolderNode {
  nodeId: string;
  name: string;
  folders: TemplateFolderNode[];
  lists: TemplateListNode[];
}

/** A captured space: top-level folders + lists. */
export interface TemplateSpaceNode {
  nodeId: string;
  name: string;
  folders: TemplateFolderNode[];
  lists: TemplateListNode[];
}

/**
 * The full snapshot persisted (JSON-stringified) on Templates.Snapshot. `anchor`
 * is the ISO reference date that all offsets are measured from. `root` is the
 * one node type matching `scopeType`.
 */
export interface TemplateSnapshot {
  scopeType: TemplateScopeType;
  anchor: string;   // ISO reference date
  root: TemplateTaskNode | TemplateListNode | TemplateFolderNode | TemplateSpaceNode;
}

// ── Docs & Wikis (Phase 7a) ───────────────────────────────────────────────────

export type DocScopeType = 'SPACE' | 'FOLDER' | 'LIST';
export type DocTaskLinkKind = 'reference' | 'embed';

export interface Doc {
  id:           string;
  workspaceId:  string;
  scopeType:    DocScopeType;
  scopeId:      string;
  name:         string;
  icon:         string | null;
  isWiki:       boolean;
  verifiedById: string | null;
  createdById:  string;
  createdAt:    string;
  updatedAt:    string;
}

export interface DocPage {
  id:           string;
  docId:        string;
  parentPageId: string | null;
  title:        string;
  icon:         string | null;
  cover:        string | null;
  position:     number;
  bodyJson:     string | null;   // rendered ProseMirror JSON (SSR first-paint); omitted from tree lists
  createdAt:    string;
  updatedAt:    string;
}

/** A page-tree node = page metadata (no body) + its children. */
export interface DocPageNode {
  id:           string;
  docId:        string;
  parentPageId: string | null;
  title:        string;
  icon:         string | null;
  position:     number;
  children:     DocPageNode[];
}

export interface DocPageVersionMeta {
  id:            string;
  pageId:        string;
  createdById:   string;
  createdByName: string;
  createdAt:     string;
}

export interface DocPageVersion extends DocPageVersionMeta {
  snapshot: string;   // ProseMirror JSON
}

export interface DocTaskLink {
  id:           string;
  docPageId:    string;
  taskId:       string;
  kind:         DocTaskLinkKind;
  taskTitle:    string;
  taskIssueKey: string;
  createdAt:    string;
}

export interface CreateDocInput {
  workspaceId: string;
  scopeType:   DocScopeType;
  scopeId:     string;
  name:        string;
  icon?:       string;
}

export interface CreateDocPageInput {
  docId:         string;
  parentPageId?: string | null;
  title?:        string;
  icon?:         string;
  /** Optional explicit sibling id to position AFTER; the service computes the fractional Position. */
  afterPageId?:  string | null;
}

export interface UpdateDocPageInput {
  title?: string;
  icon?:  string;
  cover?: string;
}

export interface MoveDocPageInput {
  parentPageId: string | null;
  /** Sibling id to drop AFTER (null = first child); the service computes the fractional Position. */
  afterPageId:  string | null;
}

export interface CreateTaskFromSelectionInput {
  docPageId: string;
  listId:    string;
  title:     string;
  kind?:     DocTaskLinkKind;   // default 'reference'
}

// ── Whiteboards (Phase 7b) ────────────────────────────────────────────────────

export type WhiteboardScopeType = 'SPACE' | 'FOLDER' | 'LIST';

/** A whiteboard's metadata. DocYjs is never serialized to the API; DocJson is
 *  the rendered tldraw snapshot used for SSR first-paint. */
export interface Whiteboard {
  id:          string;
  workspaceId: string;
  scopeType:   WhiteboardScopeType;
  scopeId:     string;
  name:        string;
  docJson:     string | null;   // rendered tldraw snapshot (SSR)
  createdById: string;
  createdAt:   string;
  updatedAt:   string;
}

/** Lightweight list row (no DocJson/DocYjs). */
export interface WhiteboardSummary {
  id:          string;
  workspaceId: string;
  scopeType:   WhiteboardScopeType;
  scopeId:     string;
  name:        string;
  createdById: string;
  createdAt:   string;
  updatedAt:   string;
}

export interface WhiteboardTaskLink {
  id:           string;
  whiteboardId: string;
  taskId:       string;
  shapeId:      string;
  createdAt:    string;
  taskTitle:    string;
  taskStatus:   string;
  taskIssueKey: string;
}

export interface CreateWhiteboardInput {
  workspaceId: string;
  scopeType:   WhiteboardScopeType;
  scopeId:     string;
  name:        string;
}

export interface UpdateWhiteboardInput {
  name?: string;
}

/** Convert a tldraw shape into a task in a target List. `shape` is the raw
 *  tldraw shape JSON; the server derives the title via extractShapeTitle. */
export interface ConvertShapeToTaskInput {
  targetListId: string;
  shapeId:      string;
  shape:        { id: string; type: string; props?: Record<string, unknown> };
}

export interface ConvertShapeToTaskResult {
  task: Task;
  link: WhiteboardTaskLink;
}

// ── Forms (Phase 7c — intake) ─────────────────────────────────────────────────

export type FormFieldType =
  | 'short_text' | 'long_text' | 'number' | 'email'
  | 'select' | 'multiselect' | 'checkbox' | 'date';

export interface FormField {
  key:       string;            // stable key (answers + mapping + branching reference this)
  label:     string;
  type:      FormFieldType;
  required:  boolean;
  options?:  string[];          // for select / multiselect
  placeholder?: string;
}

/** Show/hide a field when a PRIOR field's answer matches. Default = visible. */
export interface FormBranchingRule {
  fieldKey: string;             // the field this rule controls
  action:   'show' | 'hide';
  when:     {
    fieldKey: string;           // a field that appears EARLIER in fields[]
    op:       'equals' | 'not_equals' | 'includes' | 'is_empty' | 'is_not_empty';
    value?:   string;
  };
}

export interface FormConfig {
  fields:    FormField[];
  branching: FormBranchingRule[];
}

/** form field key -> where its answer lands on the created task. */
export type FormFieldMapping = Record<string, FormFieldMappingTarget>;
export interface FormFieldMappingTarget {
  kind:   'task' | 'custom_field';
  target: string;               // task: 'title'|'description'|'priority'; custom_field: the field id
}

export interface Form {
  id:           string;
  workspaceId:  string;
  scopeType:    'SPACE' | 'FOLDER' | 'LIST';
  scopeId:      string;
  name:         string;
  config:       FormConfig;
  targetListId: string;
  fieldMapping: FormFieldMapping;
  templateId:   string | null;
  isPublic:     boolean;
  publicSlug:   string | null;
  authRequired: boolean;
  createdById:  string;
  createdAt:    string;
  updatedAt:    string;
}

export interface FormSubmission {
  id:            string;
  formId:        string;
  answers:       Record<string, unknown>;
  createdTaskId: string | null;
  submittedById: string | null;
  submittedAt:   string;
}

/** The unauthenticated render payload (no internal ids leaked beyond config). */
export interface PublicFormView {
  id:           string;
  name:         string;
  config:       FormConfig;
  authRequired: boolean;
  readToken:    string;         // scoped, echoed back on submit
}

export interface CreateFormInput {
  workspaceId:  string;
  scopeType:    'SPACE' | 'FOLDER' | 'LIST';
  scopeId:      string;
  name:         string;
  config:       FormConfig;
  targetListId: string;
  fieldMapping: FormFieldMapping;
  templateId?:  string | null;
  isPublic?:    boolean;
  publicSlug?:  string | null;
  authRequired?: boolean;
}

export interface UpdateFormInput {
  name?:         string;
  config?:       FormConfig;
  targetListId?: string;
  fieldMapping?: FormFieldMapping;
  templateId?:   string | null;   // null clears
  isPublic?:     boolean;
  publicSlug?:   string | null;    // null clears
  authRequired?: boolean;
}

export interface SubmitFormInput {
  answers:   Record<string, unknown>;
  readToken: string;
}

export interface SubmitFormResult {
  submissionId:  string;
  createdTaskId: string | null;
}
