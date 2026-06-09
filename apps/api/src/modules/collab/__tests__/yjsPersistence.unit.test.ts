import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { docNameToTarget, renderSnapshot, seedYDoc } from '../yjsPersistence.js';

describe('docNameToTarget', () => {
  it('parses a doc-page name', () => {
    expect(docNameToTarget('doc-page:abc-123')).toEqual({ kind: 'doc-page', id: 'abc-123' });
  });
  it('parses a whiteboard name (reserved for 7b — server is generic)', () => {
    expect(docNameToTarget('whiteboard:xyz')).toEqual({ kind: 'whiteboard', id: 'xyz' });
  });
  it('returns null for an unknown/garbage name', () => {
    expect(docNameToTarget('garbage')).toBeNull();
    expect(docNameToTarget('other:1')).toBeNull();
  });
});

describe('seed + render round-trip', () => {
  it('renders a ProseMirror-JSON snapshot from a Yjs doc and re-seeds it identically', () => {
    const a = new Y.Doc();
    // Minimal: write a fragment via the prosemirror xml fragment shape.
    const frag = a.getXmlFragment('prosemirror');
    const el = new Y.XmlElement('paragraph');
    el.insert(0, [new Y.XmlText('hello')]);
    frag.insert(0, [el]);

    const json = renderSnapshot(a);
    expect(json).toContain('hello');

    const bytes = Y.encodeStateAsUpdate(a);
    const b = new Y.Doc();
    seedYDoc(b, Buffer.from(bytes));
    expect(renderSnapshot(b)).toBe(json);
  });
});
