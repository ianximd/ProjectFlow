/** Mention token format shared with the backend: @[Display Name](userId GUID). */
const TOKEN = /@\[([^\]]+)\]\(([0-9a-fA-F-]{36})\)/g;

export type MentionSegment =
  | { kind: 'text'; value: string }
  | { kind: 'mention'; name: string; userId: string };

/** Split a comment body into renderable text/mention segments. */
export function parseMentionSegments(body: string): MentionSegment[] {
  const segments: MentionSegment[] = [];
  let last = 0;
  for (const m of body.matchAll(TOKEN)) {
    const idx = m.index ?? 0;
    if (idx > last) segments.push({ kind: 'text', value: body.slice(last, idx) });
    segments.push({ kind: 'mention', name: m[1], userId: m[2] });
    last = idx + m[0].length;
  }
  if (last < body.length) segments.push({ kind: 'text', value: body.slice(last) });
  return segments.length ? segments : [{ kind: 'text', value: body }];
}

/** Build a mention token to insert into the composer. */
export function mentionToken(name: string, userId: string): string {
  return `@[${name}](${userId})`;
}
