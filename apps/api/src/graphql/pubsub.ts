import { createPubSub } from 'graphql-yoga';
import { createRedisEventTarget } from '@graphql-yoga/redis-event-target';
import { Redis } from 'ioredis';
import { subLogger } from '../shared/lib/logger.js';
import { registerCloser } from '../shared/lib/shutdown.js';

const log = subLogger('pubsub');

export type PubSubChannels = {
  'task:updated':    [{ projectId: string; task: unknown }];
  'comment:created': [{ taskId: string;   comment: unknown }];
  'space:updated':   [{ workspaceId: string; space: unknown }];
  'folder:updated':  [{ spaceId: string; folder: unknown }];
  'list:updated':    [{ spaceId: string; list: unknown }];
  'customField:updated': [{ scopeId: string; field: unknown }];
  'taskType:updated': [{ workspaceId: string; taskType: unknown }];
};

/**
 * GraphQL pubsub.
 *
 *   - When REDIS_URL is set (production / staging), pub and sub are routed
 *     through a dedicated pair of ioredis connections. SSE disconnects no
 *     longer leak in-memory listeners — Redis handles fan-out.
 *   - When REDIS_URL is empty (unit tests, ad-hoc dev), we fall back to
 *     in-memory pubsub.
 *
 * We use DEDICATED connections (not the shared `getRedis()` client) because
 * a Redis subscriber connection cannot run any other commands once
 * SUBSCRIBE is issued.
 */
function build() {
  const url = process.env.REDIS_URL;
  if (!url) {
    log.info('using in-memory pubsub (REDIS_URL unset)');
    return createPubSub<PubSubChannels>();
  }
  const publishClient   = new Redis(url, { lazyConnect: false });
  const subscribeClient = new Redis(url, { lazyConnect: false });

  registerCloser('pubsub-pub', () => publishClient.quit().catch(() => publishClient.disconnect()));
  registerCloser('pubsub-sub', () => subscribeClient.quit().catch(() => subscribeClient.disconnect()));

  const eventTarget = createRedisEventTarget({ publishClient, subscribeClient });
  log.info('using redis-backed pubsub');
  return createPubSub<PubSubChannels>({ eventTarget });
}

export const pubsub = build();
