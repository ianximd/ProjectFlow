'use client';

import { useEffect, useState, useTransition } from 'react';
import type { Tag } from '@projectflow/types';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { loadSpaceTags, loadTaskTags, createTag, linkTag, unlinkTag } from '@/server/actions/tags';
import { notifyActionError } from '@/lib/apiErrorToast';

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
        setLinkedIds(new Set(linked.map((t) => t.id)));
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

  const linked = spaceTags.filter((t) => linkedIds.has(t.id));

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      {linked.map((t) => <Chip key={t.id} tag={t} />)}
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" className="font-normal" aria-label="Edit tags">+ Tag</Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 p-2">
          <div className="flex flex-col gap-1">
            {spaceTags.length === 0 && <span className="px-2 py-1 text-xs text-muted-foreground">No tags yet</span>}
            {spaceTags.map((t) => (
              <label key={t.id} className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-accent cursor-pointer">
                <input type="checkbox" checked={linkedIds.has(t.id)} onChange={() => toggle(t)} />
                <Chip tag={t} />
              </label>
            ))}
            <div className="mt-2 flex items-center gap-1">
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); create(); } }}
                placeholder="New tag…"
                aria-label="New tag name"
                className="h-8 text-sm"
              />
              <Button variant="outline" className="h-8" onClick={create}>Add</Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
