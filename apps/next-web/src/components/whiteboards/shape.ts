// Pure, dependency-free shape→title extraction. IDENTICAL to the API's
// apps/api/src/modules/whiteboards/whiteboard.shape.ts so the client preview
// title matches the title the server will store on convert-to-task.
//
// Kept in its OWN module (not the hook) so it can be imported by unit tests and
// client components WITHOUT dragging in the hook's server-action import chain
// (getRealtimeToken -> server-only), which jsdom/vitest can't resolve.

export interface WhiteboardShapeInput {
  id:    string;
  type:  string;
  props?: Record<string, unknown> & {
    text?:     unknown;
    richText?: unknown;
  };
}

const TITLE_MAX = 500; // matches Tasks.Title NVARCHAR(500)
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
