'use client';

import { useEffect, useState } from 'react';
import * as Y from 'yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { getRealtimeToken } from '@/server/actions/realtime';

// Falls back to the API dev server on port 3001 (where attachCollabUpgrade mounts).
const WS_BASE = process.env.NEXT_PUBLIC_COLLAB_URL ?? 'ws://localhost:3001/collab';

export interface CollabHandle {
  provider: HocuspocusProvider;
  doc: Y.Doc;
}

/**
 * Connect to the Yjs collab channel for a doc-page.
 * Returns null until the provider is initialised (token fetch + WS connect).
 * Cleans up (destroys provider + ydoc) on unmount or pageId change.
 */
export function useCollabProvider(pageId: string): CollabHandle | null {
  const [handle, setHandle] = useState<CollabHandle | null>(null);

  useEffect(() => {
    let provider: HocuspocusProvider | null = null;
    let cancelled = false;
    const doc = new Y.Doc();

    (async () => {
      const res = await getRealtimeToken();
      if (cancelled || !res) return;

      provider = new HocuspocusProvider({
        url: WS_BASE,
        name: `doc-page:${pageId}`,
        document: doc,
        token: res.token,
      });

      if (!cancelled) setHandle({ provider, doc });
    })();

    return () => {
      cancelled = true;
      provider?.destroy();
      doc.destroy();
      setHandle(null);
    };
  }, [pageId]);

  return handle;
}
