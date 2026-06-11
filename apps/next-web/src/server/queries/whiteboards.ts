import 'server-only';
import { cache } from 'react';
import type { Whiteboard, WhiteboardTaskLink } from '@projectflow/types';
import { serverFetch } from '../api';

// GET /whiteboards/:id returns the `{ data }` envelope (whiteboard.routes.ts:84),
// so serverFetch (which unwraps `.data`) yields the Whiteboard directly.
// A 404 throws an ApiError; the caller (.catch(() => null)) turns it into notFound().
export const getWhiteboard = cache(async (id: string): Promise<Whiteboard | null> => {
  const wb = await serverFetch<Whiteboard | null>(`/whiteboards/${encodeURIComponent(id)}`);
  return wb ?? null;
});

// GET /whiteboards/:id/links → `{ data: WhiteboardTaskLink[] }`.
export const getWhiteboardLinks = cache(async (id: string): Promise<WhiteboardTaskLink[]> => {
  const links = await serverFetch<WhiteboardTaskLink[]>(`/whiteboards/${encodeURIComponent(id)}/links`);
  return links ?? [];
});
