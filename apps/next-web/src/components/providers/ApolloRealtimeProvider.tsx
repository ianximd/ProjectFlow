'use client';

import { ApolloProvider } from '@apollo/client/react';
import { type ReactNode, useState } from 'react';
import { getRealtimeClient } from '@/lib/realtime/apolloClient';

export function ApolloRealtimeProvider({ children }: { children: ReactNode }) {
  const [client] = useState(getRealtimeClient);
  return <ApolloProvider client={client}>{children}</ApolloProvider>;
}
