/**
 * Mentions are encoded by the composer as structured tokens:
 *   @[Display Name](<userId GUID>)
 * This extracts the unique set of mentioned user ids (lowercased) from a body,
 * preserving first-seen order. Malformed tokens are ignored.
 */
const TOKEN = /@\[[^\]]+\]\(([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\)/g;

export function extractMentionUserIds(body: string | null | undefined): string[] {
  if (!body) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of body.matchAll(TOKEN)) {
    const id = m[1].toLowerCase();
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}
