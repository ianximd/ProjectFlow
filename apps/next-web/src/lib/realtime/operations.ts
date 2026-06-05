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

// Live task updates for the board/list. The server channel is global
// (`task:updated`) — the `projectId` arg is currently a required placeholder and
// scoping happens client-side by matching the delta's id against the visible
// tasks (see mergeTaskDelta). Selection is limited to the card-rendered fields.
export const TASK_UPDATED = gql`
  subscription TaskUpdated($projectId: String!) {
    taskUpdated(projectId: $projectId) {
      id
      projectId
      issueKey
      title
      status
      priority
      type
      storyPoints
      dueDate
      sprintId
      updatedAt
    }
  }
`;
