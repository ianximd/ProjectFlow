import { createPubSub } from 'graphql-yoga';

/**
 * In-memory pub/sub channel for GraphQL subscriptions.
 * For production scale, replace with a Redis adapter.
 */
export type PubSubChannels = {
  'task:updated':    [{ projectId: string; task: unknown }];
  'comment:created': [{ taskId: string;   comment: unknown }];
};

export const pubsub = createPubSub<PubSubChannels>();
