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
  // Lowercase to match the publisher's canonical topic key — GUID case varies by
  // source (JWT vs mention-parser vs DB) and the pubsub topic is case-sensitive.
  return pubsub.subscribe('notification:added', ctx.user.userId.toLowerCase());
}
