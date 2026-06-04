'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { notifyActionError } from '@/lib/apiErrorToast';
import { bulkUpdateTasks } from '@/server/actions/views';
import { Priority } from '@projectflow/types';
import type { BulkAction, ViewScopeType } from '@projectflow/types';

interface Props {
  /** The currently-selected task ids (the bar only renders when ≥1). */
  selectedIds: string[];
  /** The view's scope (threaded for future scope-aware actions e.g. move_to_list). */
  scopeType: ViewScopeType;
  scopeId: string;
  /** Called after a successful bulk action: parent clears selection + refreshes. */
  onDone: () => void;
  /**
   * Status options for the "set status" control. Statuses are workspace-configured
   * (WorkflowStatus.name, free-form per project) so we can't enumerate them
   * statically — callers may pass the active scope's status names. When omitted we
   * fall back to the default-template statuses ('To Do' is also normalizeTask's
   * default), which the e2e + the common KANBAN/SCRUM templates use.
   */
  statusOptions?: string[];
}

const DEFAULT_STATUS_OPTIONS = ['To Do', 'In Progress', 'Done'];

// Priorities are a fixed enum in @projectflow/types (HIGHEST…LOWEST).
const PRIORITY_OPTIONS = Object.values(Priority);

// Sentinel for the "no value picked yet" option in the native selects.
const NONE = '';

export function BulkBar({ selectedIds, scopeType, scopeId, onDone, statusOptions }: Props) {
  const [pending, startTransition] = useTransition();
  // Controlled selects reset to the placeholder after each apply.
  const [status, setStatus] = useState<string>(NONE);
  const [priority, setPriority] = useState<string>(NONE);

  void scopeType;
  void scopeId;

  if (selectedIds.length === 0) return null;

  const statuses = statusOptions && statusOptions.length > 0 ? statusOptions : DEFAULT_STATUS_OPTIONS;

  const apply = (action: BulkAction, resetControls?: () => void) =>
    startTransition(async () => {
      const res = await bulkUpdateTasks(selectedIds, action);
      if (!res.ok) {
        notifyActionError(res);
        return;
      }
      const { updated, failed } = res.data;
      const msg =
        `${updated.length} updated` + (failed.length ? `, ${failed.length} failed` : '');
      if (failed.length) toast.warning(msg);
      else toast.success(msg);
      resetControls?.();
      onDone();
    });

  return (
    <div
      data-testid="bulk-bar"
      role="region"
      aria-label="Bulk edit selected tasks"
      className={cn(
        'flex flex-wrap items-center gap-3 rounded-lg border border-border',
        'bg-muted/30 px-3 py-2 text-xs',
      )}
    >
      <span data-testid="bulk-count" className="font-medium text-foreground">
        {selectedIds.length} selected
      </span>

      <div className="h-4 w-px bg-border" aria-hidden="true" />

      {/* Set status */}
      <label className="flex items-center gap-1.5">
        <span className="text-muted-foreground">Status</span>
        <select
          data-testid="bulk-set-status"
          aria-label="Set status for selected tasks"
          disabled={pending}
          value={status}
          onChange={(e) => {
            const v = e.target.value;
            setStatus(v);
            if (v !== NONE) apply({ kind: 'set_status', status: v }, () => setStatus(NONE));
          }}
          className="h-7 rounded-md border border-input bg-background px-2 text-xs text-foreground disabled:opacity-50"
        >
          <option value={NONE}>Set status…</option>
          {statuses.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>

      {/* Set priority */}
      <label className="flex items-center gap-1.5">
        <span className="text-muted-foreground">Priority</span>
        <select
          data-testid="bulk-set-priority"
          aria-label="Set priority for selected tasks"
          disabled={pending}
          value={priority}
          onChange={(e) => {
            const v = e.target.value;
            setPriority(v);
            if (v !== NONE) apply({ kind: 'set_priority', priority: v }, () => setPriority(NONE));
          }}
          className="h-7 rounded-md border border-input bg-background px-2 text-xs text-foreground disabled:opacity-50"
        >
          <option value={NONE}>Set priority…</option>
          {PRIORITY_OPTIONS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </label>

      <div className="ml-auto flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="destructive"
          disabled={pending}
          onClick={() => apply({ kind: 'delete' })}
          data-testid="bulk-delete"
          className="h-7 text-xs"
        >
          <Trash2 className="size-3.5" /> Delete
        </Button>
      </div>
    </div>
  );
}
