import { GraphQLError } from 'graphql';
import { pubsub } from '../pubsub.js';
import type { GQLContext } from '../context.js';

/** Binds the subscription to the AUTHENTICATED user's id from context — never the client-supplied arg. */
export function notificationAddedSubscribe(
  _root: unknown,
  _args: { userId?: string | null },
  ctx: GQLContext,
) {
  if (!ctx.user) {
    throw new GraphQLError('Unauthorized', { extensions: { code: 'UNAUTHENTICATED' } });
  }
  return pubsub.subscribe('notification:added', ctx.user.userId);
}
