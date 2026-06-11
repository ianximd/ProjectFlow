import { notFound } from 'next/navigation';
import { requireSession } from '@/server/session';
import { getWhiteboard, getWhiteboardLinks } from '@/server/queries/whiteboards';
import { getLists } from '@/server/queries/hierarchy';
import { WhiteboardCanvas } from '@/components/whiteboards/WhiteboardCanvas';

export default async function WhiteboardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireSession();
  const { id } = await params;

  const wb = await getWhiteboard(id).catch(() => null);
  if (!wb) notFound();

  // Convert-to-task target lists. A SPACE-scoped board can reach every List in
  // the space; FOLDER/LIST-scoped boards need a different resolver (deferred —
  // the convert panel shows the "no lists" hint there for now).
  const [links, lists] = await Promise.all([
    getWhiteboardLinks(id).catch(() => []),
    wb.scopeType === 'SPACE'
      ? getLists(wb.scopeId).catch(() => [])
      : Promise.resolve([]),
  ]);

  return (
    <WhiteboardCanvas
      whiteboardId={wb.id}
      scopeId={wb.scopeId}
      scopeType={wb.scopeType}
      initialDocJson={wb.docJson}
      links={links}
      lists={lists.map((l) => ({ id: l.id, name: l.name }))}
    />
  );
}
