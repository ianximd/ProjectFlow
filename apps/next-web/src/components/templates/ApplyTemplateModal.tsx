'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import type { Template, TemplateScopeType } from '@projectflow/types';
import type { HierarchyTreeData } from '@/components/hierarchy/SidebarTree';
import { applyTemplate } from '@/server/actions/templates';
import { notifyActionError } from '@/lib/apiErrorToast';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

// <input type="date"> wants YYYY-MM-DD; default the anchor to today.
function todayInput(): string {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** A flat target-parent option for the picker, with an indent depth for display. */
interface TargetOption {
  id: string;
  label: string;
  depth: number;
}

/**
 * Build the list of valid target parents for a template's scope:
 *  - SPACE  → the workspace (implicit single option).
 *  - FOLDER → a space or a folder (folder nests inside either).
 *  - LIST   → a space or a folder.
 *  - TASK   → a list (lists are grouped under their space as a header).
 */
function buildTargets(
  scopeType: TemplateScopeType,
  data: HierarchyTreeData,
  workspaceLabel: string,
): TargetOption[] {
  if (scopeType === 'SPACE') {
    return [{ id: data.workspaceId, label: workspaceLabel, depth: 0 }];
  }
  const out: TargetOption[] = [];
  for (const space of data.spaces) {
    const folders = data.foldersBySpace[space.id] ?? [];
    const lists = data.listsBySpace[space.id] ?? [];
    if (scopeType === 'FOLDER' || scopeType === 'LIST') {
      out.push({ id: space.id, label: space.name, depth: 0 });
      for (const f of folders) out.push({ id: f.id, label: f.name, depth: 1 });
    } else if (scopeType === 'TASK') {
      // `space:`-prefixed rows are non-selectable group headers.
      out.push({ id: `space:${space.id}`, label: space.name, depth: 0 });
      for (const l of lists) out.push({ id: l.id, label: l.name, depth: 1 });
    }
  }
  return out;
}

/**
 * "Create from template" / apply flow. Lets the user pick a target parent
 * (scoped to the template's type) and an anchor date (default today), then
 * submits applyTemplate and toasts the returned counts.
 *
 * Item-selection (importing a subset of the snapshot's nodes) is intentionally
 * deferred: the REST `GET /templates/:id` does NOT return the snapshot (only the
 * GraphQL `template.snapshot` field does), so a checkbox tree over snapshot
 * nodes can't be built from the action layer without a separate GraphQL path.
 * The backend still accepts an optional `selectedItemIds`; this modal always
 * applies the full template (the documented apply-all default).
 *
 * The caller supplies the chosen template (id + scopeType + name) and the
 * hierarchy tree data for the target picker.
 */
export function ApplyTemplateModal({
  open,
  onOpenChange,
  template,
  hierarchy,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template: Pick<Template, 'id' | 'scopeType' | 'name'>;
  hierarchy: HierarchyTreeData;
}) {
  const t = useTranslations('Templates');
  const [targetId, setTargetId] = useState('');
  const [anchorDate, setAnchorDate] = useState(todayInput());
  const [applying, startApply] = useTransition();

  const targets = useMemo(
    () => buildTargets(template.scopeType, hierarchy, t('targetWorkspace')),
    [template.scopeType, hierarchy, t],
  );

  // Re-seed on (re)open. For SPACE there is exactly one target (the workspace),
  // so pre-select it; otherwise force an explicit choice.
  useEffect(() => {
    if (!open) return;
    setAnchorDate(todayInput());
    setTargetId(template.scopeType === 'SPACE' ? hierarchy.workspaceId : '');
  }, [open, template.scopeType, hierarchy.workspaceId]);

  // `space:` prefixed options are non-selectable group headers (TASK scope only).
  const isHeader = (id: string) => id.startsWith('space:');
  const canSubmit = !!targetId && !isHeader(targetId) && !!anchorDate && !applying;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    startApply(async () => {
      const r = await applyTemplate(template.id, { targetParentId: targetId, anchorDate });
      if (!r.ok) {
        notifyActionError(r);
        return;
      }
      const { lists, tasks, views, fields } = r.data.counts;
      toast.success(t('applySuccess', { lists, tasks, views, fields }));
      onOpenChange(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !applying && onOpenChange(o)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('applyTitle')}</DialogTitle>
          <DialogDescription>{t('applyDescription', { name: template.name })}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col">
          <DialogBody className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="tpl-target">{t('targetLabel')}</Label>
              {template.scopeType === 'SPACE' ? (
                <p className="text-sm text-muted-foreground">{t('targetWorkspaceHint')}</p>
              ) : targets.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('targetEmpty')}</p>
              ) : (
                <select
                  id="tpl-target"
                  value={targetId}
                  onChange={(e) => setTargetId(e.target.value)}
                  disabled={applying}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <option value="">{t('targetPlaceholder')}</option>
                  {targets.map((o) => (
                    <option key={o.id} value={o.id} disabled={isHeader(o.id)}>
                      {`${' '.repeat(o.depth * 3)}${o.label}`}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="tpl-anchor">{t('anchorLabel')}</Label>
              <input
                id="tpl-anchor"
                type="date"
                value={anchorDate}
                onChange={(e) => setAnchorDate(e.target.value)}
                disabled={applying}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              />
              <p className="text-xs text-muted-foreground">{t('anchorHint')}</p>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={applying}>
              {t('cancel')}
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {applying ? t('applying') : t('apply')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
