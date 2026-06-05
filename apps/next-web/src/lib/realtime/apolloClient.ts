'use client';

import { ApolloClient, InMemoryCache } from '@apollo/client';
import { SSELink } from './sseLink';
import { getRealtimeToken } from '@/server/actions/realtime';

// The Apollo/SSE client runs in the browser, so it must use a browser-reachable
// origin (NOT API_INTERNAL_URL, which is a server/docker-internal hostname).
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

// In Apollo Client 4 the `ApolloClient` class is no longer generic.
let _client: ApolloClient | null = null;

/** Lazily build the singleton realtime (delta-only) Apollo client. */
export function getRealtimeClient(): ApolloClient {
  if (_client) return _client;

  const link = new SSELink({
    url: `${API_URL}/api/v1/graphql`,
    // Called on each (re)connect: fetch a fresh access token from the httpOnly cookie
    // via a server action, since the client JS can't read the cookie directly.
    headers: async (): Promise<Record<string, string>> => {
      const t = await getRealtimeToken();
      return t ? { Authorization: `Bearer ${t.token}` } : {};
    },
  });

  _client = new ApolloClient({
    link,
    cache: new InMemoryCache(),
    defaultOptions: {
      watchQuery: { fetchPolicy: 'no-cache' },
      query: { fetchPolicy: 'no-cache' },
    },
  });

  return _client;
}
