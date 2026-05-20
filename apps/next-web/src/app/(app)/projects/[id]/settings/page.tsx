import { notFound } from 'next/navigation';
import { requireSession } from '@/server/session';
import { getProject } from '@/server/queries/project';
import { ApiError } from '@/server/api';
import { ProjectSettingsDetailView } from './project-settings-detail-view';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  await requireSession();
  const { id } = await params;
  let project;
  try {
    project = await getProject(id);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 403)) notFound();
    throw e;
  }
  return <ProjectSettingsDetailView project={project} />;
}
