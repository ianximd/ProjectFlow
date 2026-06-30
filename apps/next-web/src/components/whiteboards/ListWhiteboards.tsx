'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Plus, Pencil, Trash2, PenTool } from 'lucide-react';
import type { WhiteboardSummary, WhiteboardScopeType } from '@projectflow/types';
import {
  listWhiteboards, createWhiteboard, renameWhiteboard, deleteWhiteboard,
} from '@/server/actions/whiteboards';
import { notifyActionError } from '@/lib/apiErrorToast';

/**
 * Scope-bound whiteboard manager: lists the boards in one SPACE/FOLDER/LIST and
 * offers create / open / rename / delete. The whiteboard view itself already
 * lives at /whiteboards/[id]; this is the missing discovery + CRUD surface.
 */
export function ListWhiteboards({
  workspaceId,
  scopeType,
  scopeId,
  initial,
}: {
  workspaceId: string;
  scopeType: WhiteboardScopeType;
  scopeId: string;
  initial: WhiteboardSummary[];
}) {
  const t = useTranslations('Whiteboards');
  const router = useRouter();
  const [boards, setBoards] = useState<WhiteboardSummary[]>(initial);
  const [busy, start] = useTransition();

  async function refresh() {
    const r = await listWhiteboards(workspaceId, scopeType, scopeId);
    if (r.ok) setBoards(r.data);
  }

  function handleCreate() {
    const name = window.prompt(t('namePrompt'))?.trim();
    if (!name) return;
    start(async () => {
      const r = await createWhiteboard({ workspaceId, scopeType, scopeId, name });
      if (!r.ok) {
        notifyActionError(r);
        return;
      }
      router.push(`/whiteboards/${r.data.id}`);
    });
  }

  function handleRename(b: WhiteboardSummary) {
    const name = window.prompt(t('renamePrompt'), b.name)?.trim();
    if (!name || name === b.name) return;
    start(async () => {
      const r = await renameWhiteboard(b.id, name);
      if (!r.ok) {
        notifyActionError(r);
        return;
      }
      await refresh();
    });
  }

  function handleDelete(b: WhiteboardSummary) {
    if (!window.confirm(t('deleteConfirm'))) return;
    start(async () => {
      const r = await deleteWhiteboard(b.id);
      if (!r.ok) {
        notifyActionError(r);
        return;
      }
      setBoards((prev) => prev.filter((x) => x.id !== b.id));
    });
  }

  return (
    <section className="mt-6">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">{t('heading')}</h2>
        <button
          type="button"
          onClick={handleCreate}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-sm font-medium text-foreground hover:bg-muted/40 disabled:opacity-50"
        >
          <Plus className="size-4" /> {t('newWhiteboard')}
        </button>
      </div>

      {boards.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('empty')}</p>
      ) : (
        <ul className="divide-y divide-border/60 rounded-md border border-border">
          {boards.map((b) => (
            <li key={b.id} className="group flex items-center gap-2 px-3 py-2">
              <PenTool className="size-4 shrink-0 text-muted-foreground" />
              <Link href={`/whiteboards/${b.id}`} className="flex-1 truncate text-sm hover:underline">
                {b.name}
              </Link>
              <button
                type="button"
                onClick={() => handleRename(b)}
                disabled={busy}
                aria-label={t('rename')}
                title={t('rename')}
                className="text-muted-foreground hover:text-primary disabled:opacity-50"
              >
                <Pencil className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={() => handleDelete(b)}
                disabled={busy}
                aria-label={t('delete')}
                title={t('delete')}
                className="text-muted-foreground hover:text-destructive disabled:opacity-50"
              >
                <Trash2 className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
