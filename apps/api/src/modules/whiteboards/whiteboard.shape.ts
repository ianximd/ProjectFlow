/**
 * Pure shape→task title extraction. tldraw shapes carry their text either as a
 * flat `props.text` (note/text/geo-with-label) or, in newer tldraw, a
 * ProseMirror-ish `props.richText` doc. We read both, collapse whitespace, clamp
 * to the Tasks.Title cap (500), and fall back to a stable default. Kept PURE +
 * dependency-free so it unit-tests trivially and can be mirrored client-side.
 */
export interface WhiteboardShapeInput {
  id:    string;
  type:  string;
  props?: Record<string, unknown> & {
    text?:     unknown;
    richText?: unknown;
  };
}

const TITLE_MAX = 500;        // matches Tasks.Title NVARCHAR(500)
const FALLBACK  = 'Untitled';

/** Recursively collect plain `text` runs from a tldraw/ProseMirror rich-text doc. */
function collectRichText(node: unknown): string {
  if (!node || typeof node !== 'object') return '';
  const n = node as { text?: unknown; content?: unknown };
  let out = typeof n.text === 'string' ? n.text : '';
  if (Array.isArray(n.content)) {
    for (const child of n.content) out += collectRichText(child);
  }
  return out;
}

export function extractShapeTitle(shape: WhiteboardShapeInput): string {
  const props = shape.props ?? {};
  let raw = '';
  if (typeof props.text === 'string' && props.text.trim()) {
    raw = props.text;
  } else if (props.richText) {
    raw = collectRichText(props.richText);
  }
  const cleaned = raw.replace(/\s+/g, ' ').trim();
  if (!cleaned) return FALLBACK;
  return cleaned.length > TITLE_MAX ? cleaned.slice(0, TITLE_MAX) : cleaned;
}
