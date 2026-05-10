import type { Context, Next } from 'hono';
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../../shared/lib/jwtSecret.js';

export async function authMiddleware(c: Context, next: Next) {
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: { message: 'Unauthorized: No token provided' } }, 401);
  }

  const token = authHeader.split(' ')[1];

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    c.set('user', payload);
    await next();
  } catch (error) {
    return c.json({ error: { message: 'Unauthorized: Invalid token' } }, 401);
  }
}
