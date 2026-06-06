'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { FileStack, Trash2, Play } from 'lucide-react';
import type { Template, TemplateScopeType } from '@projectflow/types';
import type { HierarchyTreeData } from '@/components/hierarchy/SidebarTree';
import { deleteTemplate } from '@/server/actions/templates';
import { notifyActionError } from '@/lib/apiErrorToast';
import { ApplyTemplateModal } from '@/components/templates/ApplyTemplateModal';
import { Button } from '@/components/ui/button';

const SCOPE_ORDER: TemplateScopeType[] = ['SPACE', 'FOLDER', 'LIST', 'TASK'];

export function TemplateCenter({
  templates,
  hierarchy,
}: {
  templates: Template[];
  hierarchy: HierarchyTreeData;
}) {
  const t = useTranslations('Templates');
  const [applyTarget, setApplyTarget] = useState<Template | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [, startDelete] = useTransition();

  const byScope = SCOPE_ORDER.map((scope) => ({
    scope,
    rows: templates.filter((tpl) => tpl.scopeType === scope),
  })).filter((g) => g.rows.length > 0);

  function handleDelete(tpl: Template) {
    if (!confirm(t('deleteConfirm', { name: tpl.name }))) return;
    setDeletingId(tpl.id);
    startDelete(async () => {
      const r = await deleteTemplate(tpl.id);
      setDeletingId(null);
      if (!r.ok) {
        notifyActionError(r);
        return;
      }
      toast.success(t('deleteSuccess', { name: tpl.name }));
    });
  }

  return (
    <div className="mx-auto w-full max-w-4xl p-6">
      <header className="mb-6 flex items-center gap-3">
        <FileStack className="size-6 text-muted-foreground" />
        <div>
          <h1 className="text-xl font-semibold">{t('centerTitle')}</h1>
          <p className="text-sm text-muted-foreground">{t('centerSubtitle')}</p>
        </div>
      </header>

      {templates.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-10 text-center">
          <p className="text-sm font-medium">{t('emptyTitle')}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t('emptyBody')}</p>
        </div>
      ) : (
        <div className="space-y-8">
          {byScope.map(({ scope, rows }) => (
            <section key={scope}>
              <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground/70">
                {t(`scope_${scope}`)}
              </h2>
              <ul className="divide-y divide-border overflow-hidden rounded-md border border-border">
                {rows.map((tpl) => (
                  <li key={tpl.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="min-w-0 grow">
                      <div className="truncate text-sm font-medium">{tpl.name}</div>
                      {tpl.description && (
                        <div className="truncate text-xs text-muted-foreground">{tpl.description}</div>
                      )}
                    </div>
                    <Button size="sm" variant="outline" onClick={() => setApplyTarget(tpl)}>
                      <Play className="size-3.5" />
                      {t('apply')}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={deletingId === tpl.id}
                      onClick={() => handleDelete(tpl)}
                      aria-label={t('deleteAria', { name: tpl.name })}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {applyTarget && (
        <ApplyTemplateModal
          open={!!applyTarget}
          onOpenChange={(o) => { if (!o) setApplyTarget(null); }}
          template={applyTarget}
          hierarchy={hierarchy}
        />
      )}
    </div>
  );
}
