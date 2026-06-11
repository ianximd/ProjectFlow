'use client';

import type { Editor, TLRecord } from 'tldraw';
import { loadSnapshot } from 'tldraw';
import * as Y from 'yjs';

/**
 * Bind a tldraw editor's store to a Y.Map<TLRecord> so every peer on the same
 * `whiteboard:<id>` doc converges on the same shapes. Returns a teardown fn.
 *
 * Verified against tldraw 5.1.0 (re-exports @tldraw/store + @tldraw/editor):
 *   - loadSnapshot(store, snapshot)        — top-level export
 *   - store.allRecords(): TLRecord[]
 *   - store.put(records: TLRecord[])
 *   - store.remove(ids: TLRecordId[])
 *   - store.clear()
 *   - store.listen(onHistory, { source, scope })
 *   - store.mergeRemoteChanges(fn)
 *   - HistoryEntry.changes = RecordsDiff = { added, updated:[from,to], removed }
 */
export function bindTldrawToYjs(
  editor: Editor,
  doc: Y.Doc,
  initialDocJson: string | null,
): () => void {
  const yStore = doc.getMap<TLRecord>('tl_records');
  const store = editor.store;
  const ORIGIN = 'tldraw-local';

  // ── Initial sync. Yjs is the source of truth once a room has records. ──
  if (yStore.size === 0) {
    // Empty room: seed Yjs from the SSR snapshot (if any), then the local store.
    if (initialDocJson) {
      try {
        loadSnapshot(store, JSON.parse(initialDocJson));
      } catch {
        /* ignore a malformed snapshot — start blank */
      }
    }
    doc.transact(() => {
      for (const r of store.allRecords()) yStore.set(r.id, r);
    }, ORIGIN);
  } else {
    // Existing room: replace the local store wholesale with the Yjs records.
    const records = [...yStore.values()];
    // Inside mergeRemoteChanges: store mutations won't echo back to Yjs.
    store.mergeRemoteChanges(() => {
      store.clear();
      store.put(records);
    });
  }

  // ── local store -> Yjs (only user-driven document changes) ──
  const unlisten = store.listen(
    (entry) => {
      doc.transact(() => {
        for (const rec of Object.values(entry.changes.added)) {
          yStore.set((rec as TLRecord).id, rec as TLRecord);
        }
        for (const [, to] of Object.values(entry.changes.updated)) {
          yStore.set((to as TLRecord).id, to as TLRecord);
        }
        for (const rec of Object.values(entry.changes.removed)) {
          yStore.delete((rec as TLRecord).id);
        }
      }, ORIGIN);
    },
    { source: 'user', scope: 'document' },
  );

  // ── Yjs -> local store (skip our own transactions) ──
  const observer = (event: Y.YMapEvent<TLRecord>, txn: Y.Transaction) => {
    if (txn.origin === ORIGIN) return;
    store.mergeRemoteChanges(() => {
      event.changes.keys.forEach((change, id) => {
        if (change.action === 'delete') {
          store.remove([id as TLRecord['id']]);
        } else {
          const r = yStore.get(id);
          if (r) store.put([r]);
        }
      });
    });
  };
  yStore.observe(observer);

  return () => {
    unlisten();
    yStore.unobserve(observer);
  };
}
