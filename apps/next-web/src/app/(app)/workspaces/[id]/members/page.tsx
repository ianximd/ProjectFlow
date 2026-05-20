import { notFound } from 'next/navigation';
import { requireSession } from '@/server/session';
import { getWorkspace, getWorkspaceMembers } from '@/server/queries/workspace';
import { ApiError } from '@/server/api';
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
  return <MembersView workspace={workspace} members={members} />;
}
