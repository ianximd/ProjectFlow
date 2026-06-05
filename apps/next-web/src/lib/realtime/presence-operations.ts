import { gql } from '@apollo/client';

export const PRESENCE_UPDATED = gql`
  subscription PresenceUpdated($taskId: String!) {
    presenceUpdated(taskId: $taskId) {
      userId
      name
      avatarUrl
      typing
    }
  }
`;

export const PRESENCE_HEARTBEAT = gql`
  mutation PresenceHeartbeat($taskId: String!, $typing: Boolean) {
    presenceHeartbeat(taskId: $taskId, typing: $typing) {
      userId
      name
      avatarUrl
      typing
    }
  }
`;

export const PRESENCE_LEAVE = gql`
  mutation PresenceLeave($taskId: String!) {
    presenceLeave(taskId: $taskId) {
      userId
    }
  }
`;
