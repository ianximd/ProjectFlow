// User & Authentication Types
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

// Workspace Types
export interface Workspace {
  id: string;
  name: string;
  slug: string;
  avatarUrl: string | null;
  ownerId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkspaceMember {
  id: string;
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  joinedAt: Date;
}

export enum WorkspaceRole {
  OWNER = 'OWNER',
  ADMIN = 'ADMIN',
  MEMBER = 'MEMBER',
  GUEST = 'GUEST',
}

// Project Types
export interface Project {
  id: string;
  workspaceId: string;
  name: string;
  key: string;
  description: string | null;
  avatarUrl: string | null;
  type: ProjectType;
  status: ProjectStatus;
  startDate: Date | null;
  endDate: Date | null;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
}

export enum ProjectType {
  SCRUM = 'SCRUM',
  KANBAN = 'KANBAN',
  BUSINESS = 'BUSINESS',
}

export enum ProjectStatus {
  ACTIVE = 'ACTIVE',
  ARCHIVED = 'ARCHIVED',
  DELETED = 'DELETED',
}

// Task/Issue Types
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

export enum IssueType {
  EPIC = 'EPIC',
  STORY = 'STORY',
  TASK = 'TASK',
  BUG = 'BUG',
  SUBTASK = 'SUBTASK',
  IMPROVEMENT = 'IMPROVEMENT',
  FEATURE = 'FEATURE',
  TEST = 'TEST',
}

export enum Priority {
  HIGHEST = 'HIGHEST',
  HIGH = 'HIGH',
  MEDIUM = 'MEDIUM',
  LOW = 'LOW',
  LOWEST = 'LOWEST',
}

// Sprint Types
export interface Sprint {
  id: string;
  projectId: string;
  name: string;
  goal: string | null;
  status: SprintStatus;
  startDate: Date | null;
  endDate: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export enum SprintStatus {
  PLANNED = 'PLANNED',
  ACTIVE = 'ACTIVE',
  COMPLETED = 'COMPLETED',
}

// Comment Types
export interface Comment {
  id: string;
  taskId: string;
  authorId: string;
  parentCommentId: string | null;
  body: string;
  isInternal: boolean;
  isPinned: boolean;
  isResolved: boolean;
  deletedAt: Date | null;
  editedAt: Date | null;
  createdAt: Date;
}

// Notification Types
export interface Notification {
  id: string;
  userId: string;
  type: string;
  payload: Record<string, unknown>;
  isRead: boolean;
  createdAt: Date;
}

// API Response Types
export interface ApiResponse<T> {
  data: T;
  meta?: {
    total?: number;
    page?: number;
    pageSize?: number;
    hasNext?: boolean;
  };
}

export interface ApiError {
  error: {
    code: string;
    message: string;
    statusCode: number;
  };
}