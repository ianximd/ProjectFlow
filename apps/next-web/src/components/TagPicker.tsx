'use client';

import { useEffect, useState, useTransition } from 'react';
import { X } from 'lucide-react';
import type { Tag } from '@projectflow/types';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { loadSpaceTags, loadTaskTags, createTag, deleteTag, linkTag, unlinkTag } from '@/server/actions/tags';
import { notifyActionError } from '@/lib/apiErrorToast';
import { useTranslations } from 'next-intl';

function Chip({ tag }: { tag: Tag }) {
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px',
        borderRadius: 12, fontSize: 12, color: '#fff', background: tag.color || '#6c63ff',
      }}
    >
      {tag.name}
    </span>
  );
}

export function TagPicker({ taskId, spaceId }: { taskId: string; spaceId: string }) {
  const t = useTranslations('Task');
  const [spaceTags, setSpaceTags] = useState<Tag[]>([]);
  const [linkedIds, setLinkedIds] = useState<Set<string>>(new Set());
  const [newName, setNewName] = useState('');
  const [, start] = useTransition();

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadSpaceTags(spaceId), loadTaskTags(taskId)])
      .then(([all, linked]) => {
        if (cancelled) return;
        setSpaceTags(all);
        setLinkedIds(new Set(linked.map((tag) => tag.id)));
      })
      .catch(() => { /* leave empty */ });
    return () => { cancelled = true; };
  }, [taskId, spaceId]);

  function toggle(tag: Tag) {
    const wasLinked = linkedIds.has(tag.id);
    const next = new Set(linkedIds);
    if (wasLinked) next.delete(tag.id); else next.add(tag.id);
    setLinkedIds(next); // optimistic
    start(async () => {
      const r = wasLinked ? await unlinkTag(taskId, tag.id) : await linkTag(taskId, tag.id);
      if (!r.ok) {
        setLinkedIds((prev) => {
          const rb = new Set(prev);
          if (wasLinked) rb.add(tag.id); else rb.delete(tag.id);
          return rb;
        });
        notifyActionError(r);
      }
    });
  }

  function create() {
    const name = newName.trim();
    if (!name) return;
    setNewName('');
    start(async () => {
      const r = await createTag(spaceId, name);
      if (!r.ok || !r.data) { notifyActionError(r as any); return; }
      const tag = r.data;
      setSpaceTags((prev) => [...prev, tag].sort((a, b) => a.name.localeCompare(b.name)));
      // auto-link the freshly created tag
      const lr = await linkTag(taskId, tag.id);
      if (lr.ok) setLinkedIds((prev) => new Set(prev).add(tag.id));
      else notifyActionError(lr);
    });
  }

  function remove(tag: Tag) {
    if (!window.confirm(t('deleteTagConfirm', { name: tag.name }))) return;
    start(async () => {
      const r = await deleteTag(tag.id);
      if (!r.ok) { notifyActionError(r); return; }
      // Drop it from the space list and any local linked state (the server has
      // already unlinked it from every task as part of the delete).
      setSpaceTags((prev) => prev.filter((x) => x.id !== tag.id));
      setLinkedIds((prev) => {
        const next = new Set(prev);
        next.delete(tag.id);
        return next;
      });
    });
  }

  const linked = spaceTags.filter((tag) => linkedIds.has(tag.id));

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      {linked.map((tag) => <Chip key={tag.id} tag={tag} />)}
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" className="font-normal" aria-label={t('editTags')}>{t('editTags')}</Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 p-2">
          <div className="flex flex-col gap-1">
            {spaceTags.length === 0 && <span className="px-2 py-1 text-xs text-muted-foreground">{t('noTagsYet')}</span>}
            {spaceTags.map((tag) => (
              <div key={tag.id} className="group flex items-center gap-2 rounded-md px-2 py-1 hover:bg-accent">
                {/* Delete lives outside the label so clicking it deletes the tag
                    space-wide rather than toggling the task link. */}
                <label className="flex flex-1 items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={linkedIds.has(tag.id)} onChange={() => toggle(tag)} />
                  <Chip tag={tag} />
                </label>
                <button
                  type="button"
                  onClick={() => remove(tag)}
                  aria-label={t('deleteTag', { name: tag.name })}
                  title={t('deleteTag', { name: tag.name })}
                  className="grid place-items-center rounded p-0.5 text-muted-foreground opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-muted hover:text-destructive"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            ))}
            <div className="mt-2 flex items-center gap-1">
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); create(); } }}
                placeholder={t('newTagPlaceholder')}
                aria-label={t('newTagAriaLabel')}
                className="h-8 text-sm"
              />
              <Button variant="outline" className="h-8" onClick={create}>{t('addTag')}</Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
