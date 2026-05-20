// Pure: pick the active id from a list given the cookie's stored id. Trust the
// cookie only if it still points at something the user has; else default to first.
export function resolveActiveId<T extends { id: string }>(list: T[], cookieId: string | null): string | null {
  if (list.length === 0) return null;
  if (cookieId && list.some((x) => x.id === cookieId)) return cookieId;
  return list[0]!.id;
}
