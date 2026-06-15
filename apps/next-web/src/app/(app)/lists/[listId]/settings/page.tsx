import { requireSession } from '@/server/session';
import { ObjectPermissionEditor } from '@/components/permissions/ObjectPermissionEditor';

export default async function ListSettingsPage({ params }: { params: Promise<{ listId: string }> }) {
  await requireSession();
  const { listId } = await params;
  return (
    <div style={{ padding: 16, maxWidth: 720 }}>
      <ObjectPermissionEditor objectType="LIST" objectId={listId} />
    </div>
  );
}
