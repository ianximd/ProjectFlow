import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { requireSession } from '@/server/session';
import { getMe } from '@/server/queries/profile';
import { getDoc, getDocTree } from '@/server/queries/docs';
import { DocWorkspace } from '@/components/docs/DocWorkspace';
import DocLoading from './loading';

export default async function DocPage({
  params,
}: {
  params: Promise<{ docId: string }>;
}) {
  await requireSession();
  const { docId } = await params;
  const [doc, pages, me] = await Promise.all([
    getDoc(docId).catch(() => null),
    getDocTree(docId).catch(() => []),
    getMe().catch(() => null),
  ]);
  if (!doc) notFound();

  return (
    <Suspense fallback={<DocLoading />}>
      <DocWorkspace doc={doc} pages={pages} me={{ name: me?.name ?? 'You' }} />
    </Suspense>
  );
}
