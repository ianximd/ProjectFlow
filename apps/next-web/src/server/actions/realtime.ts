'use server';

import { cookies } from 'next/headers';
import { COOKIE } from '../cookies';

/** Returns the current access token for bootstrapping the browser's SSE connection.
 * The token is in an httpOnly cookie the client JS can't read, so the client calls
 * this on each (re)connect to get a fresh value. Returns null when there's no session. */
export async function getRealtimeToken(): Promise<{ token: string } | null> {
  const token = (await cookies()).get(COOKIE.access)?.value;
  return token ? { token } : null;
}
