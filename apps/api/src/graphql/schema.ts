import { GraphQLError, GraphQLScalarType, Kind } from 'graphql';

import { builder } from './builder.js';
import { pubsub }  from './pubsub.js';
import { notificationAddedSubscribe } from './subscriptions/notificationAdded.js';
import { taskEventsSubscribe } from './subscriptions/taskEvents.js';
import { publishTaskEvent, publishTaskMove } from './task-events.js';
import { registerHierarchyGraphql } from './hierarchy.schema.js';
import { registerCustomFieldsGraphql } from './customfields.schema.js';
import { registerTaskTypesGraphql } from './tasktypes.schema.js';
import { registerTagsGraphql } from './tags.schema.js';
import { registerWorkLogGraphql } from './worklog.schema.js';
import { registerWatchersGraphql } from './watchers.schema.js';
import { registerDependenciesGraphql } from './dependencies.schema.js';
import { registerRelationshipsGraphql } from './relationships.schema.js';
import { registerRecurrenceGraphql } from './recurrence.schema.js';
import { registerViewsGraphql } from './views.schema.js';
import { registerTemplatesGraphql } from './templates.schema.js';
import { registerTimesheetsGraphql } from './timesheets.schema.js';
import { registerPresenceGraphql } from './presence.schema.js';
import { registerAutomationGraphql } from './automation.schema.js';
import { registerDocsGraphql } from './docs.schema.js';
import { registerWhiteboardGraphql } from './whiteboard.schema.js';
import { registerFormsGraphql } from './form.schema.js';
import { registerGoalsGraphql } from './goals.schema.js';
import { registerDashboardsGraphql } from './dashboards.schema.js';
import { requireObjectLevel, requireWorkspacePermission } from './authz.js';

// ─────────────────────────────────────────
// Services (resolvers delegate to these)
// ─────────────────────────────────────────
import { TaskRepository }    from '../modules/tasks/task.repository.js';
import { TaskService }        from '../modules/tasks/task.service.js';
import { projectService }     from '../modules/projects/project.service.js';
import { sprintService }      from '../modules/sprints/sprint.service.js';
import { commentService }     from '../modules/comments/comment.service.js';
import { workspaceService }   from '../modules/workspaces/workspace.service.js';
import { notificationService } from '../modules/notifications/notification.service.js';
import { HierarchyRepository } from '../modules/hierarchy/hierarchy.repository.js';

const taskRepo    = new TaskRepository();
const taskService = new TaskService(taskRepo);
const hierarchyRepo = new HierarchyRepository();

// ─────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────
function requireAuth(ctx: { user: unknown }): asserts ctx is { user: NonNullable<typeof ctx.user> } {
  if (!ctx.user) throw new GraphQLError('Unauthorized', { extensions: { code: 'UNAUTHENTICATED' } });
}

/** Comment author may always act; otherwise require EDIT on the task's List. */
async function assertCanEditComment(ctx: any, commentId: string): Promise<void> {
  requireAuth(ctx);
  const comment = await commentService.getById(commentId);
  if (!comment) throw new GraphQLError('Comment not found', { extensions: { code: 'NOT_FOUND' } });
  if ((ctx.user as any).userId === comment.authorId) return; // author may always act
  const task = await taskRepo.getById(comment.taskId);
  const listId = (task as any)?.listId ?? (task as any)?.ListId ?? null;
  await requireObjectLevel(ctx as any, 'LIST', listId, 'EDIT');
}

// ─────────────────────────────────────────
// GraphQL output shapes
//
// The DB row shapes in @projectflow/types include fields we deliberately don't
// expose over GraphQL (PasswordHash, MfaSecret, etc.) and use stricter unions
// than the SP results return at runtime. We declare loose shapes here that
// match the resolver expectations — `Date | string` accommodates both raw SP
// rows and already-serialised payloads (e.g. cached results).
// ─────────────────────────────────────────
type IsoOrDate = Date | string;

interface UserShape {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string | null;
  isEmailVerified?: boolean;
  createdAt: IsoOrDate;
}

interface WorkspaceShape {
  id: string;
  name: string;
  slug: string;
  avatarUrl?: string | null;
  ownerId: string;
  createdAt: IsoOrDate;
}

interface ProjectShape {
  id: string;
  workspaceId: string;
  name: string;
  key: string;
  description?: string | null;
  type: string;
  status?: string;
  createdAt: IsoOrDate;
}

interface SprintShape {
  id: string;
  projectId: string;
  listId?: string | null;
  folderId?: string | null;
  name: string;
  goal?: string | null;
  status: string;
  startDate?: IsoOrDate | null;
  endDate?: IsoOrDate | null;
  createdAt: IsoOrDate;
}

export interface TaskShape {
  id: string;
  projectId: string;
  workspaceId: string;
  issueKey: string;
  title: string;
  description?: string | null;
  type: string;
  status: string;
  priority: string;
  storyPoints?: number | null;
  sprintId?: string | null;
  reporterId: string;
  dueDate?: IsoOrDate | null;
  createdAt: IsoOrDate;
  updatedAt: IsoOrDate;
  /** Custom-field values for this task, keyed by lowercased FieldId. Only the
   *  Views engine projection populates this (see ViewRepository.queryTasks);
   *  other task sources leave it undefined and the GraphQL field resolves null. */
  customFieldValues?: Record<string, unknown>;
  /** Assignees for this task (Views engine projection). PascalCase rows as the
   *  repository produces them; the GraphQL field maps to camelCase for clients. */
  assignees?: Array<{ UserId: string; Name: string | null; Email: string; AvatarUrl: string | null }>;
}

interface CommentShape {
  id: string;
  taskId: string;
  authorId: string;
  body: string;
  createdAt: IsoOrDate;
  updatedAt?: IsoOrDate | null;
  assignedToId?: string | null;
  resolvedAt?: IsoOrDate | null;
}

interface NotificationShape {
  id: string;
  userId: string;
  type: string;
  isRead: boolean;
  savedForLater?: boolean;
  createdAt: IsoOrDate;
}

// ─────────────────────────────────────────
// Scalars
// ─────────────────────────────────────────
const DateScalar = new GraphQLScalarType({
  name:        'Date',
  description: 'ISO-8601 date-time string serialised as a JavaScript Date',
  serialize:   (v) => (v instanceof Date ? v.toISOString() : String(v)),
  parseValue:  (v) => (typeof v === 'string' ? new Date(v) : null),
  parseLiteral:(ast) => (ast.kind === Kind.STRING ? new Date(ast.value) : null),
});

builder.addScalarType('Date', DateScalar, {});

// ─────────────────────────────────────────
// Object Types — registered as typed refs first, then implemented. Using
// objectRef<Shape>(name) avoids the `'Name' as never` cast and gives proper
// inference to every t.field({ type: …Type }) reference downstream.
// ─────────────────────────────────────────
const UserType         = builder.objectRef<UserShape>('User');
const WorkspaceType    = builder.objectRef<WorkspaceShape>('Workspace');
const ProjectType      = builder.objectRef<ProjectShape>('Project');
const SprintType       = builder.objectRef<SprintShape>('Sprint');
export const TaskType  = builder.objectRef<TaskShape>('Task');
const CommentType      = builder.objectRef<CommentShape>('Comment');
const NotificationType = builder.objectRef<NotificationShape>('Notification');

UserType.implement({
  description: 'A ProjectFlow user account',
  fields: (t) => ({
    id:              t.exposeString('id'),
    email:           t.exposeString('email'),
    name:            t.exposeString('name'),
    avatarUrl:       t.string({ nullable: true, resolve: (u) => u.avatarUrl ?? null }),
    isEmailVerified: t.boolean({ resolve: (u) => Boolean(u.isEmailVerified) }),
    createdAt:       t.field({ type: 'Date', resolve: (u) => new Date(u.createdAt) }),
  }),
});

WorkspaceType.implement({
  description: 'A collaborative workspace',
  fields: (t) => ({
    id:        t.exposeString('id'),
    name:      t.exposeString('name'),
    slug:      t.exposeString('slug'),
    avatarUrl: t.string({ nullable: true, resolve: (w) => w.avatarUrl ?? null }),
    ownerId:   t.exposeString('ownerId'),
    createdAt: t.field({ type: 'Date', resolve: (w) => new Date(w.createdAt) }),
  }),
});

ProjectType.implement({
  description: 'A project inside a workspace',
  fields: (t) => ({
    id:          t.exposeString('id'),
    workspaceId: t.exposeString('workspaceId'),
    name:        t.exposeString('name'),
    key:         t.exposeString('key'),
    description: t.string({ nullable: true, resolve: (p) => p.description ?? null }),
    type:        t.exposeString('type'),
    status:      t.string({ resolve: (p) => p.status ?? 'ACTIVE' }),
    createdAt:   t.field({ type: 'Date', resolve: (p) => new Date(p.createdAt) }),
  }),
});

SprintType.implement({
  description: 'A sprint inside a project',
  fields: (t) => ({
    id:        t.exposeString('id'),
    projectId: t.exposeString('projectId'),
    name:      t.exposeString('name'),
    goal:      t.string({ nullable: true, resolve: (s) => s.goal ?? null }),
    status:    t.exposeString('status'),
    startDate: t.field({ type: 'Date', nullable: true, resolve: (s) => s.startDate ? new Date(s.startDate) : null }),
    endDate:   t.field({ type: 'Date', nullable: true, resolve: (s) => s.endDate   ? new Date(s.endDate)   : null }),
    createdAt: t.field({ type: 'Date', resolve: (s) => new Date(s.createdAt) }),
    // Phase 8c sprint-folder fields. Case-tolerant: SP rows are PascalCase.
    listId:    t.string({ nullable: true, resolve: (s: any) => s.listId ?? s.ListId ?? null }),
    folderId:  t.string({ nullable: true, resolve: (s: any) => s.folderId ?? s.FolderId ?? null }),
    points:    t.field({
      type: 'Float', nullable: true,
      resolve: async (s: any) => {
        const id = s.id ?? s.Id; if (!id) return null;
        const r = await sprintService.getPoints(id);
        return Number(r.total?.TotalPoints ?? 0);
      },
    }),
  }),
});

const TaskAssigneeType = builder.objectRef<{ UserId: string; Name: string | null; Email: string; AvatarUrl: string | null }>('TaskAssignee');
TaskAssigneeType.implement({
  description: 'A user assigned to a task (lightweight projection for board avatar stacks)',
  fields: (t) => ({
    userId:    t.exposeString('UserId'),
    name:      t.string({ nullable: true, resolve: (a) => a.Name ?? null }),
    email:     t.exposeString('Email'),
    avatarUrl: t.string({ nullable: true, resolve: (a) => a.AvatarUrl ?? null }),
  }),
});

TaskType.implement({
  description: 'A task / issue',
  // Field resolvers read BOTH casings. Most callers (GraphQL queries, the Views
  // projection) hand TaskType a camelCase row, but the live `taskEvents`
  // subscription publishes the raw task SP row, which is PascalCase (Id, Title,
  // Status, …). A bare `t.exposeString('id')` reads only `row.id`, so on the SP
  // row every scalar resolved to null and the board's live `created`/`updated`
  // payload arrived empty (no id/title/status → no card). Coalesce here, the
  // same way `normalize-task.ts` does on the client, so both shapes serialize.
  fields: (t) => ({
    id:          t.string({ resolve: (x: any) => x.id ?? x.Id ?? null }),
    projectId:   t.string({ nullable: true, resolve: (x: any) => x.projectId ?? x.ProjectId ?? null }),
    workspaceId: t.string({ nullable: true, resolve: (x: any) => x.workspaceId ?? x.WorkspaceId ?? null }),
    listId:      t.string({ nullable: true, resolve: (x: any) => x.listId ?? x.ListId ?? null }),
    issueKey:    t.string({ nullable: true, resolve: (x: any) => x.issueKey ?? x.IssueKey ?? null }),
    title:       t.string({ resolve: (x: any) => x.title ?? x.Title ?? null }),
    description: t.string({ nullable: true, resolve: (x: any) => x.description ?? x.Description ?? null }),
    type:        t.string({ nullable: true, resolve: (x: any) => x.type ?? x.Type ?? null }),
    status:      t.string({ nullable: true, resolve: (x: any) => x.status ?? x.Status ?? null }),
    priority:    t.string({ nullable: true, resolve: (x: any) => x.priority ?? x.Priority ?? null }),
    storyPoints: t.int({ nullable: true, resolve: (x: any) => x.storyPoints ?? x.StoryPoints ?? null }),
    sprintId:    t.string({ nullable: true, resolve: (x: any) => x.sprintId ?? x.SprintId ?? null }),
    reporterId:  t.string({ nullable: true, resolve: (x: any) => x.reporterId ?? x.ReporterId ?? null }),
    dueDate:     t.field({ type: 'Date', nullable: true, resolve: (x: any) => { const v = x.dueDate ?? x.DueDate; return v ? new Date(v) : null; } }),
    createdAt:   t.field({ type: 'Date', nullable: true, resolve: (x: any) => { const v = x.createdAt ?? x.CreatedAt; return v ? new Date(v) : null; } }),
    updatedAt:   t.field({ type: 'Date', nullable: true, resolve: (x: any) => { const v = x.updatedAt ?? x.UpdatedAt; return v ? new Date(v) : null; } }),
    // JSON object string of { [lowercasedFieldId]: rawStoredValue }. Mirrors how
    // SavedView.config is transported as a String. Null when the task carries no
    // custom values (or came from a non-views source that doesn't populate them).
    customFieldValues: t.string({ nullable: true, resolve: (tk) =>
      tk.customFieldValues && Object.keys(tk.customFieldValues).length > 0
        ? JSON.stringify(tk.customFieldValues)
        : null }),
    // Assignees for board avatar stacks (Views engine projection). Empty list
    // when the task has none, or came from a source that doesn't populate them.
    assignees: t.field({ type: [TaskAssigneeType], resolve: (tk) => tk.assignees ?? [] }),
  }),
});

// A keyed live task lifecycle event. `kind` is created | updated | deleted;
// `task` carries the full task for create/update, `taskId` identifies the
// removed task on delete (when no task body is sent).
const TaskEventType = builder.objectRef<{ kind: string; task?: unknown; taskId?: string }>('TaskEvent').implement({
  fields: (t) => ({
    kind:   t.string({ resolve: (e) => e.kind }),
    task:   t.field({ type: TaskType, nullable: true, resolve: (e) => (e.task ?? null) as any }),
    taskId: t.string({ nullable: true, resolve: (e) => e.taskId ?? null }),
  }),
});

CommentType.implement({
  description: 'A comment on a task',
  fields: (t) => ({
    id:        t.exposeString('id'),
    taskId:    t.exposeString('taskId'),
    authorId:  t.exposeString('authorId'),
    body:      t.exposeString('body'),
    createdAt: t.field({ type: 'Date', resolve: (c) => new Date(c.createdAt) }),
    updatedAt: t.field({ type: 'Date', nullable: true, resolve: (c) => c.updatedAt ? new Date(c.updatedAt) : null }),
    assignedToId: t.exposeString('assignedToId', { nullable: true }),
    resolvedAt:   t.field({ type: 'Date', nullable: true, resolve: (c) => (c.resolvedAt ? new Date(c.resolvedAt) : null) }),
  }),
});

NotificationType.implement({
  description: 'An in-app notification',
  fields: (t) => ({
    id:           t.exposeString('id'),
    userId:       t.exposeString('userId'),
    type:         t.exposeString('type'),
    isRead:       t.boolean({ resolve: (n) => Boolean(n.isRead) }),
    savedForLater: t.boolean({ resolve: (n) => Boolean((n as any).savedForLater) }),
    createdAt:    t.field({ type: 'Date', resolve: (n) => new Date(n.createdAt) }),
  }),
});

// ─────────────────────────────────────────
// Input Types
// ─────────────────────────────────────────
const CreateTaskInput = builder.inputType('CreateTaskInput', {
  fields: (t) => ({
    projectId:   t.string({ required: true }),
    workspaceId: t.string({ required: true }),
    title:       t.string({ required: true }),
    description: t.string({ required: false }),
    type:        t.string({ required: false }),      // STORY | BUG | TASK | EPIC | SUBTASK
    priority:    t.string({ required: false }),      // LOW | MEDIUM | HIGH | URGENT
    sprintId:    t.string({ required: false }),
    storyPoints: t.int({ required: false }),
    dueDate:     t.field({ type: 'Date', required: false }),
    listId:      t.string({ required: false }),
    parentTaskId: t.string({ required: false }),
  }),
});

const UpdateTaskInput = builder.inputType('UpdateTaskInput', {
  fields: (t) => ({
    title:       t.string({ required: false }),
    description: t.string({ required: false }),
    priority:    t.string({ required: false }),
    sprintId:    t.string({ required: false }),
    storyPoints: t.int({ required: false }),
    dueDate:     t.field({ type: 'Date', required: false }),
  }),
});

// ─────────────────────────────────────────
// Queries
// ─────────────────────────────────────────
builder.queryType({
  fields: (t) => ({
    /** Currently-authenticated user */
    me: t.field({
      type:    UserType,
      nullable: true,
      resolve: (_, __, ctx) => {
        if (!ctx.user) return null;
        return { id: ctx.user.userId, email: ctx.user.email, name: ctx.user.name ?? '' } as any;
      },
    }),

    /** Workspaces the authenticated user belongs to */
    workspaces: t.field({
      type:    [WorkspaceType],
      resolve: async (_, __, ctx) => {
        requireAuth(ctx);
        return (await workspaceService.list((ctx.user as any).userId)) as unknown as WorkspaceShape[];
      },
    }),

    /** Single workspace by ID */
    workspace: t.field({
      type:     WorkspaceType,
      nullable: true,
      args: { id: t.arg.string({ required: true }) },
      resolve: async (_, { id }, ctx) => {
        requireAuth(ctx);
        return (await workspaceService.getById(id)) as WorkspaceShape | null;
      },
    }),

    /** Projects in a workspace */
    projects: t.field({
      type:    [ProjectType],
      args: { workspaceId: t.arg.string({ required: true }) },
      resolve: async (_, { workspaceId }, ctx) => {
        requireAuth(ctx);
        return (await projectService.list(workspaceId)) as unknown as ProjectShape[];
      },
    }),

    /** Single project by ID */
    project: t.field({
      type:     ProjectType,
      nullable: true,
      args: { id: t.arg.string({ required: true }) },
      resolve: async (_, { id }, ctx) => {
        requireAuth(ctx);
        return (await projectService.getById(id)) as ProjectShape | null;
      },
    }),

    /** Sprints in a project */
    sprints: t.field({
      type:    [SprintType],
      args: { projectId: t.arg.string({ required: true }) },
      resolve: async (_, { projectId }, ctx) => {
        requireAuth(ctx);
        return (await sprintService.list(projectId)) as unknown as SprintShape[];
      },
    }),

    /** Paginated task list */
    tasks: t.field({
      type:    [TaskType],
      args: {
        projectId: t.arg.string({ required: true }),
        status:    t.arg.string({ required: false }),
        sprintId:  t.arg.string({ required: false }),
        page:      t.arg.int({ required: false }),
        pageSize:  t.arg.int({ required: false }),
      },
      resolve: async (_, args, ctx) => {
        requireAuth(ctx);
        const { tasks } = await taskService.listTasks({
          projectId: args.projectId,
          status:    args.status    ?? undefined,
          sprintId:  args.sprintId  ?? undefined,
          page:      args.page      ?? 1,
          pageSize:  args.pageSize  ?? 25,
        } as any);
        return tasks as any;
      },
    }),

    /** Single task by ID */
    task: t.field({
      type:     TaskType,
      nullable: true,
      args: { id: t.arg.string({ required: true }) },
      resolve: async (_, { id }, ctx) => {
        requireAuth(ctx);
        return taskService.getTask(id);
      },
    }),

    /** Comments on a task */
    comments: t.field({
      type:    [CommentType],
      args: { taskId: t.arg.string({ required: true }) },
      resolve: async (_, { taskId }, ctx) => {
        requireAuth(ctx);
        return commentService.list(taskId);
      },
    }),

    /** Notifications for the authenticated user */
    notifications: t.field({
      type:    [NotificationType],
      args: {
        page:       t.arg.int({ required: false }),
        pageSize:   t.arg.int({ required: false }),
        unreadOnly: t.arg.boolean({ required: false }),
        types:      t.arg.stringList({ required: false }),
        savedOnly:  t.arg.boolean({ required: false }),
      },
      resolve: async (_, args, ctx) => {
        requireAuth(ctx);
        const { notifications } = await notificationService.list(
          (ctx.user as any).userId,
          args.page      ?? 1,
          args.pageSize  ?? 25,
          args.unreadOnly ?? false,
          args.types     ?? undefined,
          args.savedOnly ?? false,
        );
        return notifications as any;
      },
    }),
  }),
});

// ─────────────────────────────────────────
// Mutations
// ─────────────────────────────────────────
// Task SPs return PascalCase columns (Id, ProjectId, …) with no normalization,
// so reading `.projectId` on an SP-returned task is undefined. The task:event
// pubsub topic is keyed on projectId (prj:{projectId}); an undefined key
// delivers to no subscriber. Coalesce both casings at every publish site.
const eventProjectId = (t: any): string => (t?.projectId ?? t?.ProjectId ?? null) as string;
builder.mutationType({
  fields: (t) => ({
    /** Create a new task */
    createTask: t.field({
      type:    TaskType,
      args:    { input: t.arg({ type: CreateTaskInput, required: true }) },
      resolve: async (_, { input }, ctx) => {
        requireAuth(ctx);
        const actorId = (ctx.user as any).userId;
        const task = await taskService.createTask(input as any, actorId);
        await publishTaskEvent('created', { projectId: eventProjectId(task), task });
        return task as any;
      },
    }),

    /** Phase 8c: create a sprint as a List under a sprint-flagged Folder. */
    createSprintInFolder: t.field({
      type: SprintType,
      args: {
        folderId:  t.arg.string({ required: true }),
        name:      t.arg.string({ required: true }),
        goal:      t.arg.string({ required: false }),
        startDate: t.arg({ type: 'Date', required: false }),
        endDate:   t.arg({ type: 'Date', required: false }),
      },
      resolve: async (_, a, ctx) => {
        requireAuth(ctx);
        // Mirror the REST gate: caller needs sprint.create in the folder's workspace.
        await requireWorkspacePermission(ctx as any, await sprintService.getFolderWorkspaceId(a.folderId), 'sprint.create');
        const row: any = await sprintService.createInFolder(
          a.folderId, a.name, a.goal ?? null,
          a.startDate ? new Date(a.startDate as any) : null,
          a.endDate ? new Date(a.endDate as any) : null,
        );
        // usp_Sprint_CreateInFolder returns a raw PascalCase SELECT * row; normalize
        // to the camelCase SprintShape so SprintType's exposeString resolvers work.
        return {
          id:        row.id        ?? row.Id,
          projectId: row.projectId ?? row.ProjectId,
          listId:    row.listId    ?? row.ListId    ?? null,
          folderId:  row.folderId  ?? row.FolderId  ?? null,
          name:      row.name      ?? row.Name,
          goal:      row.goal      ?? row.Goal      ?? null,
          status:    row.status    ?? row.Status,
          startDate: row.startDate ?? row.StartDate ?? null,
          endDate:   row.endDate   ?? row.EndDate   ?? null,
          createdAt: row.createdAt ?? row.CreatedAt,
        } as SprintShape;
      },
    }),

    /** Phase 8c: roll unfinished tasks from one sprint into another; returns count. */
    rollForwardSprint: t.field({
      type: 'Int',
      args: { fromSprintId: t.arg.string({ required: true }), toSprintId: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => {
        requireAuth(ctx);
        // Gate on the SOURCE workspace; usp_Sprint_RollForward throws 50049 if the
        // target sprint is in a different workspace (cross-tenant teleport guard).
        await requireWorkspacePermission(ctx as any, await sprintService.getSprintWorkspaceId(a.fromSprintId), 'sprint.manage');
        return await sprintService.rollForward(a.fromSprintId, a.toSprintId);
      },
    }),

    /** Partial update of task fields */
    updateTask: t.field({
      type:     TaskType,
      nullable: true,
      args: {
        id:    t.arg.string({ required: true }),
        input: t.arg({ type: UpdateTaskInput, required: true }),
      },
      resolve: async (_, { id, input }, ctx) => {
        requireAuth(ctx);
        const actorId = (ctx.user as any).userId;
        const task = await taskService.updateTask(id, input as any, actorId);
        if (task) {
          await publishTaskEvent('updated', { projectId: eventProjectId(task), task });
        }
        return task as any;
      },
    }),

    /** Transition a task to a new status */
    transitionTask: t.field({
      type:    TaskType,
      args: {
        id:     t.arg.string({ required: true }),
        status: t.arg.string({ required: true }),
      },
      resolve: async (_, { id, status }, ctx) => {
        requireAuth(ctx);
        const actorId = (ctx.user as any).userId;
        const task = await taskService.transitionTask(id, status, actorId);
        await publishTaskEvent('updated', { projectId: eventProjectId(task), task });
        return task as any;
      },
    }),

    /** Delete a task */
    deleteTask: t.field({
      type:    'Boolean',
      args: { id: t.arg.string({ required: true }) },
      resolve: async (_, { id }, ctx) => {
        requireAuth(ctx);
        const actorId = (ctx.user as any).userId;
        const task = await taskService.deleteTask(id, actorId);
        await publishTaskEvent('deleted', { projectId: eventProjectId(task), taskId: id });
        return true;
      },
    }),

    /** Add a comment to a task */
    createComment: t.field({
      type:    CommentType,
      args: {
        taskId: t.arg.string({ required: true }),
        body:   t.arg.string({ required: true }),
      },
      resolve: async (_, { taskId, body }, ctx) => {
        requireAuth(ctx);
        const authorId = (ctx.user as any).userId;
        const comment = await commentService.create({ taskId, body } as any, authorId);
        return comment as any;
      },
    }),

    /** Assign a comment to a workspace member (creates an action item). */
    assignComment: t.field({
      type: CommentType,
      args: { commentId: t.arg.string({ required: true }), assigneeId: t.arg.string({ required: true }) },
      resolve: async (_, { commentId, assigneeId }, ctx) => {
        await assertCanEditComment(ctx, commentId);
        let updated;
        try {
          updated = await commentService.assign(commentId, assigneeId, (ctx.user as any).userId);
        } catch (err: any) {
          if (err?.number === 51403 || String(err?.message).includes('51403'))
            throw new GraphQLError('Not a workspace member', { extensions: { code: 'FORBIDDEN' } });
          throw err;
        }
        if (!updated) throw new GraphQLError('Comment not found', { extensions: { code: 'NOT_FOUND' } });
        return updated as any;
      },
    }),

    /** Mark a comment resolved or unresolved. */
    resolveComment: t.field({
      type: CommentType,
      args: { commentId: t.arg.string({ required: true }), resolved: t.arg.boolean({ required: true }) },
      resolve: async (_, { commentId, resolved }, ctx) => {
        await assertCanEditComment(ctx, commentId);
        let updated;
        try {
          updated = await commentService.resolve(commentId, (ctx.user as any).userId, resolved);
        } catch (err: any) {
          if (err?.number === 51403 || String(err?.message).includes('51403'))
            throw new GraphQLError('Not a workspace member', { extensions: { code: 'FORBIDDEN' } });
          throw err;
        }
        if (!updated) throw new GraphQLError('Comment not found', { extensions: { code: 'NOT_FOUND' } });
        return updated as any;
      },
    }),

    /** Mark a single notification as read */
    markNotificationRead: t.field({
      type:    'Boolean',
      args: { id: t.arg.string({ required: true }) },
      resolve: async (_, { id }, ctx) => {
        requireAuth(ctx);
        await notificationService.markRead(id, (ctx.user as any).userId);
        return true;
      },
    }),

    /** Save or un-save a notification for later */
    setNotificationSaved: t.field({
      type: 'Boolean',
      args: { id: t.arg.string({ required: true }), saved: t.arg.boolean({ required: true }) },
      resolve: async (_, { id, saved }, ctx) => {
        requireAuth(ctx);
        await notificationService.setSaved(id, (ctx.user as any).userId, saved);
        return true;
      },
    }),

    /** Mark all notifications read for the authenticated user */
    markAllNotificationsRead: t.field({
      type:    'Int',
      resolve: async (_, __, ctx) => {
        requireAuth(ctx);
        return notificationService.markAllRead((ctx.user as any).userId);
      },
    }),
  }),
});

// ─────────────────────────────────────────
// Subscriptions
// ─────────────────────────────────────────
builder.subscriptionType({
  fields: (t) => ({
    /**
     * Keyed live task lifecycle events. Subscribe by `projectId` (a Space —
     * VIEW-gated) or `workspaceId` (RBAC `workspace.read`) — exactly one. The
     * payload is the {kind, task?, taskId?} event the TaskEvent type reads.
     */
    taskEvents: t.field({
      type: TaskEventType,
      args: {
        projectId:   t.arg.string({ required: false }),
        workspaceId: t.arg.string({ required: false }),
      },
      subscribe: (_, args, ctx) => taskEventsSubscribe(args, ctx),
      resolve: (payload: any) => payload,
    }),

    /** Emitted whenever a comment is posted on the given task */
    commentAdded: t.field({
      type:    CommentType,
      args: {
        taskId: t.arg.string({ required: true }),
      },
      subscribe: (_, { taskId }, ctx) => {
        requireAuth(ctx);
        return pubsub.subscribe('comment:created');
      },
      resolve: (payload: any) => payload.comment,
    }),

    /** Live in-app notifications for the authenticated user only. */
    notificationAdded: t.field({
      type: NotificationType,
      args: { userId: t.arg.string({ required: false }) }, // accepted but IGNORED; bound to ctx user
      subscribe: (root, args, ctx) => notificationAddedSubscribe(root, args, ctx),
      resolve: (payload: any) => payload.notification,
    }),
  }),
});

// ─────────────────────────────────────────
// Hierarchy (Phase 1) — task move + everythingUnder (need the local TaskType).
// ─────────────────────────────────────────
builder.mutationFields((t) => ({
  moveTask: t.field({
    type: TaskType,
    nullable: true,
    args: {
      taskId:   t.arg.string({ required: true }),
      listId:   t.arg.string({ required: true }),
      position: t.arg.float({ required: true }),
    },
    resolve: async (_, { taskId, listId, position }, ctx) => {
      requireAuth(ctx);
      const before = await taskService.getTask(taskId);
      const oldProjectId = (before as any)?.projectId ?? (before as any)?.ProjectId ?? null;
      const task = await taskService.moveTask(taskId, listId, position);
      if (task) await publishTaskMove(oldProjectId, task);
      return task as any;
    },
  }),
}));

builder.queryFields((t) => ({
  everythingUnder: t.field({
    type: [TaskType],
    args: {
      nodeType: t.arg.string({ required: true }),
      nodeId:   t.arg.string({ required: true }),
    },
    resolve: async (_, { nodeType, nodeId }, ctx) => {
      requireAuth(ctx);
      return (await hierarchyRepo.descendantTasks(nodeType as any, nodeId)) as any;
    },
  }),
}));

// ─────────────────────────────────────────
// Hierarchy (Phase 1) — Folder/List/EffectiveStatus types + queries/mutations.
// Registered here (after the root Query/Mutation types exist, before toSchema).
// ─────────────────────────────────────────
registerHierarchyGraphql();

// ─────────────────────────────────────────
// Custom Fields (Phase 2) — CustomField/EffectiveField types + queries/mutation.
// ─────────────────────────────────────────
registerCustomFieldsGraphql();

// ─────────────────────────────────────────
// Task Types (Phase 2) — TaskType type + taskTypes query + setTaskType mutation.
// ─────────────────────────────────────────
registerTaskTypesGraphql();

// ─────────────────────────────────────────
// Tags (Phase 2) — Tag type + spaceTags query + create/delete/link/unlink.
// ─────────────────────────────────────────
registerTagsGraphql();

// ─────────────────────────────────────────
// Work Logs (Phase 8a) — WorkLog/TaskTimeRollup types + taskWorkLogs/activeTimer/
// taskTimeRollup queries + startTimer/stopTimer/create/update/deleteWorkLog.
// ─────────────────────────────────────────
registerWorkLogGraphql();

// ─────────────────────────────────────────
// Watchers (Phase 2) — TaskWatcher type + taskWatchers query + add/remove.
// ─────────────────────────────────────────
registerWatchersGraphql();

// ─────────────────────────────────────────
// Dependencies (Phase 5a) — TaskDependencyRef/TaskDependencyLists types +
// taskDependencies query + addTaskDependency/removeTaskDependency mutations.
// ─────────────────────────────────────────
registerDependenciesGraphql();

// ─────────────────────────────────────────
// Relationships (Phase 5b) — RelationshipRef type + taskRelationships query +
// addTaskRelationship/removeTaskRelationship mutations.
// ─────────────────────────────────────────
registerRelationshipsGraphql();

// ─────────────────────────────────────────
// Recurrence (Phase 5c) — TaskRecurrence type + taskRecurrence query +
// setTaskRecurrence/clearTaskRecurrence mutations.
// ─────────────────────────────────────────
registerRecurrenceGraphql();

// ─────────────────────────────────────────
// Views (Phase 3) — SavedView/ViewTaskPage/ViewGroup types + savedViews/
// viewTasks/previewViewTasks queries + create/update/delete/reorder mutations.
// ─────────────────────────────────────────
registerViewsGraphql();
registerTemplatesGraphql();

// ─────────────────────────────────────────
// Timesheets (Phase 8b) — Timesheet/TimesheetAggregate types + timesheet/
// timesheetAggregate queries + submitTimesheet/reviewTimesheet mutations.
// ─────────────────────────────────────────
registerTimesheetsGraphql();

// ─────────────────────────────────────────
// Presence (Phase 3.5c) — PresenceUser type + presenceHeartbeat/presenceLeave
// mutations + presenceUpdated subscription (VIEW-gated, per-task channel).
// ─────────────────────────────────────────
registerPresenceGraphql();

// ─────────────────────────────────────────
// Automation (Phase 6a) — AutomationRule/AutomationRun types + automationRules/
// automationRuns queries + create/update/toggle/delete mutations.
// ─────────────────────────────────────────
registerAutomationGraphql();

// ─────────────────────────────────────────
// Docs & Wikis (Phase 7a) — Doc/DocPage/DocPageVersion/DocTaskLink types +
// docsByScope/doc/docPages/docPageVersions/docPageLinks queries +
// createDoc/createDocPage/moveDocPage/restoreDocPageVersion/setDocWiki mutations.
// ─────────────────────────────────────────
registerDocsGraphql();

// ─────────────────────────────────────────
// Whiteboards (Phase 7b) — Whiteboard/WhiteboardSummary/WhiteboardTaskLink/
// ConvertShapeToTaskResult types + whiteboards/whiteboard queries +
// createWhiteboard/updateWhiteboard/deleteWhiteboard/convertShapeToTask mutations.
// ─────────────────────────────────────────
registerWhiteboardGraphql();

// ─────────────────────────────────────────
// Forms (Phase 7c) — Form/FormSubmission types + forms/form/formSubmissions
// queries + createForm/updateForm/deleteForm mutations.
// ─────────────────────────────────────────
registerFormsGraphql();

// ─────────────────────────────────────────
// Goals & Targets (Phase 8e) — Goal/Target types + goals/goal queries +
// createGoal/updateGoal/deleteGoal/createTarget mutations.
// ─────────────────────────────────────────
registerGoalsGraphql();

// ─────────────────────────────────────────
// Dashboards (Phase 9a) — Dashboard/DashboardCard/CardData types +
// dashboards/dashboard/dashboardCardData queries +
// createDashboard/updateDashboard/deleteDashboard/createDashboardCard/
// setDefaultDashboard mutations.
// ─────────────────────────────────────────
registerDashboardsGraphql();

// ─────────────────────────────────────────
// Build & export
// ─────────────────────────────────────────
export const schema = builder.toSchema();
