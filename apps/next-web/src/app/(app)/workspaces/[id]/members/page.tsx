import { notFound } from 'next/navigation';
import { requireSession } from '@/server/session';
import { getWorkspace, getWorkspaceMembers } from '@/server/queries/workspace';
import { getProjects } from '@/server/queries/projects';
import { getFolders, getLists } from '@/server/queries/hierarchy';
import { loadGuests } from '@/server/actions/guests';
import { ApiError } from '@/server/api';
import type { ObjectOption } from '@/components/settings/GuestManagementPanel';
import { MembersView } from './members-view';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  await requireSession();
  const { id } = await params;
  let workspace;
  let members;
  try {
    [workspace, members] = await Promise.all([getWorkspace(id), getWorkspaceMembers(id)]);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 403)) notFound();
    throw e;
  }

  // Guest management: a guest is granted access to a Folder or List (never a whole
  // Space), so enumerate the workspace's folders + lists as the invite targets.
  // Tolerant of per-space access failures — a space the viewer can't read just
  // contributes no options rather than failing the whole members page.
  const spaces = await getProjects(id).catch(() => []);
  const objectOptions: ObjectOption[] = [];
  await Promise.all(
    spaces.map(async (s) => {
      const [folders, lists] = await Promise.all([
        getFolders(s.id).catch(() => []),
        getLists(s.id).catch(() => []),
      ]);
      for (const f of folders) objectOptions.push({ type: 'FOLDER', id: f.id, label: `${s.name} / ${f.name}` });
      for (const l of lists)   objectOptions.push({ type: 'LIST',   id: l.id, label: `${s.name} / ${l.name}` });
    }),
  );
  const { guests, pending } = await loadGuests(id);

  return (
    <MembersView
      workspace={workspace}
      members={members}
      initialGuests={guests}
      initialPending={pending}
      objectOptions={objectOptions}
    />
  );
}
