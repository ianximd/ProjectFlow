import { createYoga } from 'graphql-yoga';
import { schema }      from './schema.js';
import { buildContext } from './context.js';
import { pubsub }       from './pubsub.js';

/**
 * GraphQL Yoga instance.
 *
 * - graphiql: enabled (disable in production via env flag)
 * - SSE subscriptions work without an additional WebSocket server
 * - Context is built per-request and carries the authenticated user + pubsub
 */
export const yoga = createYoga({
  schema,
  graphiql:        process.env.GRAPHQL_PLAYGROUND !== 'false',
  graphqlEndpoint: '/api/v1/graphql',
  context:         ({ request }) => buildContext(request, pubsub),
  // Return introspection result (disable in hardened prod via env flag)
  maskedErrors:    process.env.NODE_ENV === 'production',
});
