'use client';

import { useEffect, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import type { TemplateScopeType } from '@projectflow/types';
import { createTemplate } from '@/server/actions/templates';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * Small "Save as template" dialog (name + optional description). Captures a
 * snapshot of the given source node via createTemplate. Used from both the
 * sidebar hierarchy nodes (space/folder/list) and the TaskDrawer (task).
 */
export function SaveAsTemplateModal({
  open,
  onOpenChange,
  scopeType,
  sourceId,
  /** Pre-fill the name field with the source node's name. */
  defaultName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scopeType: TemplateScopeType;
  sourceId: string;
  defaultName?: string;
}) {
  const t = useTranslations('Templates');
  const [name, setName] = useState(defaultName ?? '');
  const [description, setDescription] = useState('');
  const [saving, startSave] = useTransition();

  // Re-seed the form whenever the dialog (re)opens for a node.
  useEffect(() => {
    if (open) {
      setName(defaultName ?? '');
      setDescription('');
    }
  }, [open, defaultName]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    startSave(async () => {
      const r = await createTemplate({
        scopeType,
        sourceId,
        name: trimmed,
        description: description.trim() || null,
      });
      if (!r.ok) {
        notifyActionError(r);
        return;
      }
      toast.success(t('saveSuccess', { name: r.data.name }));
      onOpenChange(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('saveTitle')}</DialogTitle>
          <DialogDescription>{t('saveDescription', { scope: t(`scope_${scopeType}`) })}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col">
          <DialogBody className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="tpl-name">{t('nameLabel')}</Label>
              <Input
                id="tpl-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('namePlaceholder')}
                autoFocus
                required
                disabled={saving}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tpl-desc">{t('descriptionLabel')}</Label>
              <textarea
                id="tpl-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t('descriptionPlaceholder')}
                rows={3}
                disabled={saving}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              {t('cancel')}
            </Button>
            <Button type="submit" disabled={saving || !name.trim()}>
              {saving ? t('saving') : t('save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
