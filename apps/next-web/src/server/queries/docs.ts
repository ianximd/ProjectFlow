import 'server-only';
import { serverFetch } from '../api';
import type { Doc, DocPage } from '@projectflow/types';

export async function getDoc(docId: string): Promise<Doc> {
  return serverFetch<Doc>(`/docs/${encodeURIComponent(docId)}`);
}

export async function getDocTree(docId: string): Promise<DocPage[]> {
  return serverFetch<DocPage[]>(`/docs/${encodeURIComponent(docId)}/pages`);
}

export async function getDocPage(pageId: string): Promise<DocPage> {
  // The page GET returns bodyJson for SSR first-paint.
  return serverFetch<DocPage>(`/docs/pages/${encodeURIComponent(pageId)}`);
}
