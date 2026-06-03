/** Materialized-path helpers. Path = '/' + ancestor ids in order + trailing '/'. */

export function spacePath(spaceId: string): string {
  return `/${spaceId}/`;
}
export function folderPath(parentPath: string, folderId: string): string {
  return `${parentPath}${folderId}/`;
}
export function listPath(parentPath: string, listId: string): string {
  return `${parentPath}${listId}/`;
}
/** Prefix for "everything under node X" — WHERE ListPath LIKE descendantPrefix(path) + '%'. */
export function descendantPrefix(nodePath: string): string {
  return nodePath;
}
/** Replace an old ancestor prefix with a new one when a container moves. */
export function rewritePrefix(path: string, oldPrefix: string, newPrefix: string): string {
  if (!path.startsWith(oldPrefix)) return path;
  return newPrefix + path.slice(oldPrefix.length);
}
