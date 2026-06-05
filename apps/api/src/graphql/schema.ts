import { GraphQLError, GraphQLScalarType, Kind } from 'graphql';

import { builder } from './builder.js';
import { pubsub }  from './pubsub.js';
import { notificationAddedSubscribe } from './subscriptions/notificationAdded.js';
import { registerHierarchyGraphql } from './hierarchy.schema.js';
import { registerCustomFieldsGraphql } from './customfields.schema.js';
import { registerTaskTypesGraphql } from './tasktypes.schema.js';
import { registerTagsGraphql } from './tags.schema.js';
import { registerWatchersGraphql } from './watchers.schema.js';
import { registerViewsGraphql } from './views.schema.js';
import { registerPresenceGraphql } from './presence.schema.js';
import { requireObjectLevel } from './authz.js';

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
  fields: (t) => ({
    id:          t.exposeString('id'),
    projectId:   t.exposeString('projectId'),
    workspaceId: t.exposeString('workspaceId'),
    issueKey:    t.exposeString('issueKey'),
    title:       t.exposeString('title'),
    description: t.string({ nullable: true, resolve: (tk) => tk.description ?? null }),
    type:        t.exposeString('type'),
    status:      t.exposeString('status'),
    priority:    t.exposeString('priority'),
    storyPoints: t.int({ nullable: true, resolve: (tk) => tk.storyPoints ?? null }),
    sprintId:    t.string({ nullable: true, resolve: (tk) => tk.sprintId ?? null }),
    reporterId:  t.exposeString('reporterId'),
    dueDate:     t.field({ type: 'Date', nullable: true, resolve: (tk) => tk.dueDate ? new Date(tk.dueDate) : null }),
    createdAt:   t.field({ type: 'Date', resolve: (tk) => new Date(tk.createdAt) }),
    updatedAt:   t.field({ type: 'Date', resolve: (tk) => new Date(tk.updatedAt) }),
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
        // Publish to subscription channel
        pubsub.publish('task:updated', { projectId: input.projectId, task });
        return task as any;
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
          pubsub.publish('task:updated', { projectId: (task as any).projectId, task });
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
        pubsub.publish('task:updated', { projectId: (task as any).projectId, task });
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
        await taskService.deleteTask(id, actorId);
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
        const updated = await commentService.assign(commentId, assigneeId, (ctx.user as any).userId);
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
        const updated = await commentService.resolve(commentId, (ctx.user as any).userId, resolved);
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
     * Emitted whenever a task in the given project is created,
     * updated, or transitioned.
     */
    taskUpdated: t.field({
      type:    TaskType,
      args: {
        projectId: t.arg.string({ required: true }),
      },
      subscribe: (_, { projectId }, ctx) => {
        requireAuth(ctx);
        return pubsub.subscribe('task:updated');
      },
      resolve: (payload: any) => payload.task,
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
      const task = await taskService.moveTask(taskId, listId, position);
      if (task) pubsub.publish('task:updated', { projectId: (task as any).projectId, task });
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
// Watchers (Phase 2) — TaskWatcher type + taskWatchers query + add/remove.
// ─────────────────────────────────────────
registerWatchersGraphql();

// ─────────────────────────────────────────
// Views (Phase 3) — SavedView/ViewTaskPage/ViewGroup types + savedViews/
// viewTasks/previewViewTasks queries + create/update/delete/reorder mutations.
// ─────────────────────────────────────────
registerViewsGraphql();

// ─────────────────────────────────────────
// Presence (Phase 3.5c) — PresenceUser type + presenceHeartbeat/presenceLeave
// mutations + presenceUpdated subscription (VIEW-gated, per-task channel).
// ─────────────────────────────────────────
registerPresenceGraphql();

// ─────────────────────────────────────────
// Build & export
// ─────────────────────────────────────────
export const schema = builder.toSchema();
