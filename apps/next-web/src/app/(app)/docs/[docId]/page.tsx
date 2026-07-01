import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { requireSession } from '@/server/session';
import { getMe } from '@/server/queries/profile';
import { getDoc, getDocTree } from '@/server/queries/docs';
import { getWorkspaceProjectContext } from '@/server/context';
import { getLists } from '@/server/queries/hierarchy';
import { DocWorkspace } from '@/components/docs/DocWorkspace';
import DocLoading from './loading';

export default async function DocPage({
  params,
}: {
  params: Promise<{ docId: string }>;
}) {
  await requireSession();
  const { docId } = await params;
  const [doc, pages, me, ctx] = await Promise.all([
    getDoc(docId).catch(() => null),
    getDocTree(docId).catch(() => []),
    getMe().catch(() => null),
    getWorkspaceProjectContext().catch(() => null),
  ]);
  if (!doc) notFound();

  // Candidate lists for "create task from selection". No workspace-wide list
  // loader exists (getLists is space-scoped), so flatten the workspace's
  // projects' lists into one picker set — same approach as the form builder.
  const listsNested = await Promise.all(
    (ctx?.projects ?? []).map((p) => getLists(p.id).catch(() => [])),
  );
  const lists = listsNested.flat().map((l) => ({ id: l.id, name: l.name }));

  return (
    <Suspense fallback={<DocLoading />}>
      <DocWorkspace doc={doc} pages={pages} me={{ name: me?.name ?? 'You' }} lists={lists} />
    </Suspense>
  );
}
