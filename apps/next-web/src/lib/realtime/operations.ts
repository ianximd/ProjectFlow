import { gql } from '@apollo/client';

export const NOTIFICATION_ADDED = gql`
  subscription NotificationAdded {
    notificationAdded {
      id
      type
      isRead
      createdAt
    }
  }
`;

export const COMMENT_ADDED = gql`
  subscription CommentAdded($taskId: String!) {
    commentAdded(taskId: $taskId) {
      id
      taskId
      authorId
      body
      createdAt
    }
  }
`;

// Live task events (created/updated/deleted) for the board/list/views.
// Scoped by projectId or workspaceId; client-side `accepts` decides whether a
// created task belongs in the current view (see applyTaskEvent).
export const TASK_EVENTS = gql`
  subscription TaskEvents($projectId: String, $workspaceId: String) {
    taskEvents(projectId: $projectId, workspaceId: $workspaceId) {
      kind
      taskId
      task {
        id
        projectId
        listId
        issueKey
        title
        status
        priority
        type
        storyPoints
        dueDate
        sprintId
        updatedAt
        customFieldValues
        assignees { userId name email avatarUrl }
      }
    }
  }
`;
