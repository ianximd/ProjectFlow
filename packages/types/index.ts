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
}

export interface CreateTaskInput {
  projectId: string;
  workspaceId: string;
  title: string;
  description?: string | null;
  type?: string;
  priority?: string;
  reporterId: string;
  sprintId?: string | null;
  storyPoints?: number | null;
  dueDate?: string | Date | null;
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

export type WorkflowStatusCategory = 'TODO' | 'IN_PROGRESS' | 'DONE';

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

export type AutomationTriggerType =
  | 'ISSUE_CREATED'
  | 'ISSUE_UPDATED'
  | 'ISSUE_TRANSITIONED'
  | 'SPRINT_STARTED'
  | 'SPRINT_COMPLETED'
  | 'DUE_DATE_APPROACHING'
  | 'SCHEDULED'
  | 'MANUAL'
  | 'WEBHOOK';

export interface AutomationTriggerConfig {
  type: AutomationTriggerType;
  /** For SCHEDULED: cron expression */
  cron?: string;
  /** For ISSUE_TRANSITIONED: only fire when moving to this status */
  toStatus?: string;
  /** For DUE_DATE_APPROACHING: hours before due date */
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

export type AutomationActionType =
  | 'TRANSITION_ISSUE'
  | 'ASSIGN_ISSUE'
  | 'UNASSIGN_ISSUE'
  | 'SET_PRIORITY'
  | 'ADD_COMMENT'
  | 'SEND_NOTIFICATION'
  | 'TRIGGER_WEBHOOK';

export interface AutomationAction {
  type: AutomationActionType;
  /** TRANSITION_ISSUE */
  toStatus?: string;
  /** ASSIGN_ISSUE: userId or "REPORTER" */
  assigneeId?: string;
  /** SET_PRIORITY */
  priority?: string;
  /** ADD_COMMENT / SEND_NOTIFICATION */
  message?: string;
  /** TRIGGER_WEBHOOK */
  webhookUrl?: string;
}

export interface AutomationRule {
  id: string;
  projectId: string;
  name: string;
  isEnabled: boolean;
  trigger: AutomationTriggerConfig;
  conditions: AutomationCondition[];
  actions: AutomationAction[];
  executionCount: number;
  lastExecutedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── Time Tracking / Work Logs ─────────────────────────────────────────────────

export interface WorkLogUser {
  id:        string;
  name:      string;
  avatarUrl: string | null;
}

export interface WorkLog {
  id:               string;
  taskId:           string;
  user:             WorkLogUser;
  timeSpentSeconds: number;
  startedAt:        string;
  description:      string | null;
  createdAt:        string;
}

export interface WorkLogTotals {
  user:         WorkLogUser;
  totalSeconds: number;
}

export interface WorkLogListResult {
  logs:   WorkLog[];
  totals: WorkLogTotals[];
}

export interface CreateWorkLogInput {
  taskId:           string;
  timeSpentSeconds: number;
  startedAt:        string;
  description?:     string;
}

export interface UpdateWorkLogInput {
  timeSpentSeconds?: number;
  startedAt?:        string;
  description?:      string;
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
  | 'member.invited';

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

export interface AdminWorkspace {
  id:           string;
  name:         string;
  slug:         string;
  avatarUrl:    string | null;
  ownerEmail:   string | null;
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
