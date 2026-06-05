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
