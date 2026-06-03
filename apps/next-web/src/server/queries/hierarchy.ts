import 'server-only';
import { cache } from 'react';
import { serverFetch } from '../api';
import { normalizeFolder, normalizeList, type Folder, type List } from './normalize';

export const getFolders = cache(async (spaceId: string): Promise<Folder[]> => {
  const data = await serverFetch<any[]>(`/folders?spaceId=${encodeURIComponent(spaceId)}`);
  return (data ?? []).map(normalizeFolder);
});

export const getLists = cache(async (spaceId: string): Promise<List[]> => {
  const data = await serverFetch<any[]>(`/lists?spaceId=${encodeURIComponent(spaceId)}`);
  return (data ?? []).map(normalizeList);
});

export const getEverythingUnder = cache(async (nodeType: 'SPACE' | 'FOLDER' | 'LIST', nodeId: string) => {
  return serverFetch<any[]>(`/hierarchy/everything?nodeType=${nodeType}&nodeId=${encodeURIComponent(nodeId)}`);
});
