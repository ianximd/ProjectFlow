import { getTranslations } from 'next-intl/server';
import { requireSession } from '@/server/session';
import { serverFetch } from '@/server/api';
import { AskAiPanel } from '@/components/ai/AskAiPanel';

interface WorkspaceRow { id?: string; Id?: string }

/**
 * Ask AI route (Phase 11b). Resolves the target workspace from ?workspaceId=,
 * falling back to the user's first workspace, then renders the client panel.
 */
export default async function AskPage({
  searchParams,
}: {
  searchParams: Promise<{ workspaceId?: string }>;
}) {
  await requireSession();
  const t = await getTranslations('Ai');
  const { workspaceId } = await searchParams;

  let wsId = workspaceId ?? null;
  if (!wsId) {
    const workspaces = await serverFetch<WorkspaceRow[]>('/workspaces');
    wsId = workspaces?.[0]?.id ?? workspaces?.[0]?.Id ?? null;
  }

  return (
    <div className="max-w-2xl p-6">
      <h1 className="mb-4 text-lg font-semibold">{t('ask')}</h1>
      {wsId ? (
        <AskAiPanel workspaceId={wsId} />
      ) : (
        <p className="text-sm text-muted-foreground">{t('noAnswer')}</p>
      )}
    </div>
  );
}
