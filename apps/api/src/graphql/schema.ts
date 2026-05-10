import { GraphQLError, GraphQLScalarType, Kind } from 'graphql';

import { builder } from './builder.js';
import { pubsub }  from './pubsub.js';

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

const taskRepo    = new TaskRepository();
const taskService = new TaskService(taskRepo);

// ─────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────
function requireAuth(ctx: { user: unknown }): asserts ctx is { user: NonNullable<typeof ctx.user> } {
  if (!ctx.user) throw new GraphQLError('Unauthorized', { extensions: { code: 'UNAUTHENTICATED' } });
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
// Object Types
// ─────────────────────────────────────────
const UserType = builder.objectType('User' as never, {
  description: 'A ProjectFlow user account',
  fields: (t) => ({
    id:              t.string({ resolve: (u: any) => u.id }),
    email:           t.string({ resolve: (u: any) => u.email }),
    name:            t.string({ resolve: (u: any) => u.name }),
    avatarUrl:       t.string({ nullable: true, resolve: (u: any) => u.avatarUrl ?? null }),
    isEmailVerified: t.boolean({ resolve: (u: any) => Boolean(u.isEmailVerified) }),
    createdAt:       t.field({ type: 'Date', resolve: (u: any) => new Date(u.createdAt) }),
  }),
});

const WorkspaceType = builder.objectType('Workspace' as never, {
  description: 'A collaborative workspace',
  fields: (t) => ({
    id:        t.string({ resolve: (w: any) => w.id }),
    name:      t.string({ resolve: (w: any) => w.name }),
    slug:      t.string({ resolve: (w: any) => w.slug }),
    avatarUrl: t.string({ nullable: true, resolve: (w: any) => w.avatarUrl ?? null }),
    ownerId:   t.string({ resolve: (w: any) => w.ownerId }),
    createdAt: t.field({ type: 'Date', resolve: (w: any) => new Date(w.createdAt) }),
  }),
});

const ProjectType = builder.objectType('Project' as never, {
  description: 'A project inside a workspace',
  fields: (t) => ({
    id:          t.string({ resolve: (p: any) => p.id }),
    workspaceId: t.string({ resolve: (p: any) => p.workspaceId }),
    name:        t.string({ resolve: (p: any) => p.name }),
    key:         t.string({ resolve: (p: any) => p.key }),
    description: t.string({ nullable: true, resolve: (p: any) => p.description ?? null }),
    type:        t.string({ resolve: (p: any) => p.type }),
    status:      t.string({ resolve: (p: any) => p.status ?? 'ACTIVE' }),
    createdAt:   t.field({ type: 'Date', resolve: (p: any) => new Date(p.createdAt) }),
  }),
});

const SprintType = builder.objectType('Sprint' as never, {
  description: 'A sprint inside a project',
  fields: (t) => ({
    id:        t.string({ resolve: (s: any) => s.id }),
    projectId: t.string({ resolve: (s: any) => s.projectId }),
    name:      t.string({ resolve: (s: any) => s.name }),
    goal:      t.string({ nullable: true, resolve: (s: any) => s.goal ?? null }),
    status:    t.string({ resolve: (s: any) => s.status }),
    startDate: t.field({ type: 'Date', nullable: true, resolve: (s: any) => s.startDate ? new Date(s.startDate) : null }),
    endDate:   t.field({ type: 'Date', nullable: true, resolve: (s: any) => s.endDate   ? new Date(s.endDate)   : null }),
    createdAt: t.field({ type: 'Date', resolve: (s: any) => new Date(s.createdAt) }),
  }),
});

const TaskType = builder.objectType('Task' as never, {
  description: 'A task / issue',
  fields: (t) => ({
    id:          t.string({ resolve: (tk: any) => tk.id }),
    projectId:   t.string({ resolve: (tk: any) => tk.projectId }),
    workspaceId: t.string({ resolve: (tk: any) => tk.workspaceId }),
    issueKey:    t.string({ resolve: (tk: any) => tk.issueKey }),
    title:       t.string({ resolve: (tk: any) => tk.title }),
    description: t.string({ nullable: true, resolve: (tk: any) => tk.description ?? null }),
    type:        t.string({ resolve: (tk: any) => tk.type }),
    status:      t.string({ resolve: (tk: any) => tk.status }),
    priority:    t.string({ resolve: (tk: any) => tk.priority }),
    storyPoints: t.int({ nullable: true, resolve: (tk: any) => tk.storyPoints ?? null }),
    sprintId:    t.string({ nullable: true, resolve: (tk: any) => tk.sprintId ?? null }),
    reporterId:  t.string({ resolve: (tk: any) => tk.reporterId }),
    dueDate:     t.field({ type: 'Date', nullable: true, resolve: (tk: any) => tk.dueDate ? new Date(tk.dueDate) : null }),
    createdAt:   t.field({ type: 'Date', resolve: (tk: any) => new Date(tk.createdAt) }),
    updatedAt:   t.field({ type: 'Date', resolve: (tk: any) => new Date(tk.updatedAt) }),
  }),
});

const CommentType = builder.objectType('Comment' as never, {
  description: 'A comment on a task',
  fields: (t) => ({
    id:        t.string({ resolve: (c: any) => c.id }),
    taskId:    t.string({ resolve: (c: any) => c.taskId }),
    authorId:  t.string({ resolve: (c: any) => c.authorId }),
    body:      t.string({ resolve: (c: any) => c.body }),
    createdAt: t.field({ type: 'Date', resolve: (c: any) => new Date(c.createdAt) }),
    updatedAt: t.field({ type: 'Date', nullable: true, resolve: (c: any) => c.updatedAt ? new Date(c.updatedAt) : null }),
  }),
});

const NotificationType = builder.objectType('Notification' as never, {
  description: 'An in-app notification',
  fields: (t) => ({
    id:        t.string({ resolve: (n: any) => n.id }),
    userId:    t.string({ resolve: (n: any) => n.userId }),
    type:      t.string({ resolve: (n: any) => n.type }),
    isRead:    t.boolean({ resolve: (n: any) => Boolean(n.isRead) }),
    createdAt: t.field({ type: 'Date', resolve: (n: any) => new Date(n.createdAt) }),
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
      type:    'User' as never,
      nullable: true,
      resolve: (_, __, ctx) => {
        if (!ctx.user) return null;
        return { id: ctx.user.userId, email: ctx.user.email, name: ctx.user.name ?? '' } as any;
      },
    }),

    /** Workspaces the authenticated user belongs to */
    workspaces: t.field({
      type:    ['Workspace' as never],
      resolve: async (_, __, ctx) => {
        requireAuth(ctx);
        return workspaceService.list((ctx.user as any).userId);
      },
    }),

    /** Single workspace by ID */
    workspace: t.field({
      type:     'Workspace' as never,
      nullable: true,
      args: { id: t.arg.string({ required: true }) },
      resolve: async (_, { id }, ctx) => {
        requireAuth(ctx);
        return workspaceService.getById(id);
      },
    }),

    /** Projects in a workspace */
    projects: t.field({
      type:    ['Project' as never],
      args: { workspaceId: t.arg.string({ required: true }) },
      resolve: async (_, { workspaceId }, ctx) => {
        requireAuth(ctx);
        return projectService.list(workspaceId);
      },
    }),

    /** Single project by ID */
    project: t.field({
      type:     'Project' as never,
      nullable: true,
      args: { id: t.arg.string({ required: true }) },
      resolve: async (_, { id }, ctx) => {
        requireAuth(ctx);
        return projectService.getById(id);
      },
    }),

    /** Sprints in a project */
    sprints: t.field({
      type:    ['Sprint' as never],
      args: { projectId: t.arg.string({ required: true }) },
      resolve: async (_, { projectId }, ctx) => {
        requireAuth(ctx);
        return sprintService.list(projectId);
      },
    }),

    /** Paginated task list */
    tasks: t.field({
      type:    ['Task' as never],
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
      type:     'Task' as never,
      nullable: true,
      args: { id: t.arg.string({ required: true }) },
      resolve: async (_, { id }, ctx) => {
        requireAuth(ctx);
        return taskService.getTask(id);
      },
    }),

    /** Comments on a task */
    comments: t.field({
      type:    ['Comment' as never],
      args: { taskId: t.arg.string({ required: true }) },
      resolve: async (_, { taskId }, ctx) => {
        requireAuth(ctx);
        return commentService.list(taskId);
      },
    }),

    /** Notifications for the authenticated user */
    notifications: t.field({
      type:    ['Notification' as never],
      args: {
        page:      t.arg.int({ required: false }),
        pageSize:  t.arg.int({ required: false }),
        unreadOnly: t.arg.boolean({ required: false }),
      },
      resolve: async (_, args, ctx) => {
        requireAuth(ctx);
        const { notifications } = await notificationService.list(
          (ctx.user as any).userId,
          args.page     ?? 1,
          args.pageSize ?? 25,
          args.unreadOnly ?? false,
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
      type:    'Task' as never,
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
      type:     'Task' as never,
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
      type:    'Task' as never,
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
      type:    'Boolean' as never,
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
      type:    'Comment' as never,
      args: {
        taskId: t.arg.string({ required: true }),
        body:   t.arg.string({ required: true }),
      },
      resolve: async (_, { taskId, body }, ctx) => {
        requireAuth(ctx);
        const authorId = (ctx.user as any).userId;
        const comment = await commentService.create({ taskId, body } as any, authorId);
        pubsub.publish('comment:created', { taskId, comment });
        return comment as any;
      },
    }),

    /** Mark a single notification as read */
    markNotificationRead: t.field({
      type:    'Boolean' as never,
      args: { id: t.arg.string({ required: true }) },
      resolve: async (_, { id }, ctx) => {
        requireAuth(ctx);
        await notificationService.markRead(id, (ctx.user as any).userId);
        return true;
      },
    }),

    /** Mark all notifications read for the authenticated user */
    markAllNotificationsRead: t.field({
      type:    'Int' as never,
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
      type:    'Task' as never,
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
      type:    'Comment' as never,
      args: {
        taskId: t.arg.string({ required: true }),
      },
      subscribe: (_, { taskId }, ctx) => {
        requireAuth(ctx);
        return pubsub.subscribe('comment:created');
      },
      resolve: (payload: any) => payload.comment,
    }),
  }),
});

// ─────────────────────────────────────────
// Build & export
// ─────────────────────────────────────────
export const schema = builder.toSchema();
