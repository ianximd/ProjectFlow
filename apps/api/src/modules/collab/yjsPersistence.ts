import * as Y from 'yjs';
import { yXmlFragmentToProsemirrorJSON } from 'y-prosemirror';

export type CollabKind = 'doc-page' | 'whiteboard';
export interface CollabTarget { kind: CollabKind; id: string; }

/** Decode the Hocuspocus document name `<kind>:<id>`. Generic so 7b reuses it. */
export function docNameToTarget(documentName: string): CollabTarget | null {
  const idx = documentName.indexOf(':');
  if (idx <= 0) return null;
  const kind = documentName.slice(0, idx);
  const id = documentName.slice(idx + 1);
  if ((kind !== 'doc-page' && kind !== 'whiteboard') || !id) return null;
  return { kind, id };
}

/** Render the canonical ProseMirror-JSON snapshot from a Yjs doc's
 *  'prosemirror' XML fragment. Powers SSR first-paint + search indexing.
 *
 *  y-prosemirror@1.3.7 exports `yXmlFragmentToProsemirrorJSON(fragment)`
 *  (fragment-level) — verified against the installed dist .d.ts. The
 *  whole-doc helper `yDocToProsemirrorJSON(ydoc, 'prosemirror')` is the
 *  equivalent and also exported; we use the fragment form so the named
 *  XML fragment ('prosemirror') is explicit at the call site. */
export function renderSnapshot(ydoc: Y.Doc): string {
  const fragment = ydoc.getXmlFragment('prosemirror');
  return JSON.stringify(yXmlFragmentToProsemirrorJSON(fragment));
}

/** Apply persisted binary state onto a fresh Yjs doc (onLoadDocument). */
export function seedYDoc(ydoc: Y.Doc, bytes: Buffer): void {
  if (bytes && bytes.length > 0) Y.applyUpdate(ydoc, new Uint8Array(bytes));
}
