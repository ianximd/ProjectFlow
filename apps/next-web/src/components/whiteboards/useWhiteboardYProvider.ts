'use client';

import { useEffect, useState } from 'react';
import * as Y from 'yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { getRealtimeToken } from '@/server/actions/realtime';

// Mirrors useCollabProvider — same WS base + dev fallback to the API's /collab mount.
const WS_BASE = process.env.NEXT_PUBLIC_COLLAB_URL ?? 'ws://localhost:3001/collab';

export interface WhiteboardYHandle {
  provider: HocuspocusProvider;
  doc: Y.Doc;
  /** True once the Hocuspocus WS is synced (room records available). */
  connected: boolean;
}

/**
 * Connect to the Yjs collab channel for a whiteboard (room `whiteboard:<id>`).
 * Returns null until the provider is initialised (token fetch + WS connect),
 * then a handle whose `connected` flips true on the provider's `synced` event.
 * Cleans up (destroys provider + ydoc) on unmount or id change.
 */
export function useWhiteboardYProvider(whiteboardId: string): WhiteboardYHandle | null {
  const [handle, setHandle] = useState<WhiteboardYHandle | null>(null);

  useEffect(() => {
    let provider: HocuspocusProvider | null = null;
    let cancelled = false;
    // Tracks whether doc has been destroyed so we never call doc.destroy() twice
    // (the guard path and the cleanup path are mutually exclusive for the doc,
    // but we use this flag as an explicit contract).
    let docDestroyed = false;
    const doc = new Y.Doc();

    const destroyDoc = (): void => {
      if (!docDestroyed) {
        docDestroyed = true;
        doc.destroy();
      }
    };

    (async () => {
      const res = await getRealtimeToken();
      if (cancelled || !res) return;

      provider = new HocuspocusProvider({
        url: WS_BASE,
        name: `whiteboard:${whiteboardId}`,
        document: doc,
        token: res.token,
        onSynced: () => {
          if (!cancelled) setHandle((h) => (h ? { ...h, connected: true } : h));
        },
      });

      // Guard: if unmount raced between the await and the line above, the cleanup
      // already set cancelled=true and destroyed doc. Destroy the just-opened
      // provider to close the WS, then bail — no setHandle, no further work.
      if (cancelled) {
        provider.destroy();
        destroyDoc(); // no-op if cleanup already destroyed it
        return;
      }

      setHandle({ provider, doc, connected: provider.isSynced });
    })();

    return () => {
      cancelled = true;
      provider?.destroy();
      destroyDoc();
      setHandle(null);
    };
  }, [whiteboardId]);

  return handle;
}

// Re-export the pure shape→title extractor (lives in ./shape so unit tests +
// the convert panel can import it without this hook's server-action chain).
export { extractShapeTitle, type WhiteboardShapeInput } from './shape';
