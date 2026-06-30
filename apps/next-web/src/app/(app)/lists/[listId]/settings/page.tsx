import type { WhiteboardSummary } from '@projectflow/types';
import { requireSession } from '@/server/session';
import { getWorkspaceProjectContext } from '@/server/context';
import { listWhiteboards } from '@/server/actions/whiteboards';
import { ObjectPermissionEditor } from '@/components/permissions/ObjectPermissionEditor';
import { ListWhiteboards } from '@/components/whiteboards/ListWhiteboards';

export default async function ListSettingsPage({ params }: { params: Promise<{ listId: string }> }) {
  await requireSession();
  const { listId } = await params;
  const { activeWorkspaceId } = await getWorkspaceProjectContext();

  // Whiteboards are scoped to this LIST; surface them here as the discovery +
  // create/rename/delete entry point (the board view lives at /whiteboards/[id]).
  let boards: WhiteboardSummary[] = [];
  if (activeWorkspaceId) {
    const r = await listWhiteboards(activeWorkspaceId, 'LIST', listId);
    if (r.ok) boards = r.data;
  }

  return (
    <div style={{ padding: 16, maxWidth: 720 }}>
      <ObjectPermissionEditor objectType="LIST" objectId={listId} />
      {activeWorkspaceId && (
        <ListWhiteboards
          workspaceId={activeWorkspaceId}
          scopeType="LIST"
          scopeId={listId}
          initial={boards}
        />
      )}
    </div>
  );
}
