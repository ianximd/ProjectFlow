import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../shared/lib/jwtSecret.js';
import type { pubsub } from './pubsub.js';

export interface GQLUser {
  userId: string;
  email:  string;
  name?:  string;
}

export interface GQLContext {
  user:   GQLUser | null;
  pubsub: typeof pubsub;
}

export function buildContext(
  request: Request,
  ps: typeof pubsub,
): GQLContext {
  const auth = request.headers.get('Authorization');
  if (!auth?.startsWith('Bearer ')) return { user: null, pubsub: ps };

  const token  = auth.split(' ')[1];

  try {
    const payload = jwt.verify(token, JWT_SECRET) as GQLUser;
    return { user: payload, pubsub: ps };
  } catch {
    return { user: null, pubsub: ps };
  }
}
