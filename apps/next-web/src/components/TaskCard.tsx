'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Bug,
  Bookmark,
  CheckSquare,
  Award,
  GitBranch,
  Sparkles,
  Zap,
  FlaskConical,
  GripVertical,
  X,
  Clock,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { formatShortDate, formatShortTime, formatDateTime } from '@/lib/date';

// Raw API row from the backend SPs (PascalCase fields). The component reads
// either casing defensively (Id || id, Title || content, …).
type ApiTask = Record<string, any>;

export interface AssigneeRow {
  TaskId:    string;
  UserId:    string;
  Email:     string;
  Name:      string;
  AvatarUrl: string | null;
}

interface Props {
  task: ApiTask;
  assignees?: AssigneeRow[];
  deleteTask: (id: string) => void;
  onOpen?: (task: ApiTask) => void;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

function AssigneeStack({ assignees }: { assignees: AssigneeRow[] }) {
  if (assignees.length === 0) return null;
  const visible  = assignees.slice(0, 3);
  const overflow = assignees.length - visible.length;
  return (
    <div
      className="flex -space-x-1.5"
      role="list"
      aria-label={`Assignees: ${assignees.map((a) => a.Name).join(', ')}`}
    >
      {visible.map((a) => (
        <Avatar
          key={a.UserId}
          className="size-5 ring-2 ring-card"
          title={a.Name || a.Email}
          role="listitem"
        >
          {a.AvatarUrl ? (
            <AvatarImage src={a.AvatarUrl} alt={a.Name} className="size-5" />
          ) : null}
          <AvatarFallback className="text-[9px] font-medium">
            {initials(a.Name || a.Email)}
          </AvatarFallback>
        </Avatar>
      ))}
      {overflow > 0 && (
        <span
          className="inline-flex size-5 items-center justify-center rounded-full bg-muted text-[9px] font-semibold text-muted-foreground ring-2 ring-card"
          title={assignees.slice(3).map((a) => a.Name).join(', ')}
          aria-label={`${overflow} more`}
        >
          +{overflow}
        </span>
      )}
    </div>
  );
}

// ── Type → icon + color (matches the IssueType union in @projectflow/types)
const TYPE_META: Record<string, { Icon: typeof Bug; classes: string; label: string }> = {
  BUG:         { Icon: Bug,          classes: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300',                label: 'Bug' },
  STORY:       { Icon: Bookmark,     classes: 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300',        label: 'Story' },
  TASK:        { Icon: CheckSquare,  classes: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300',            label: 'Task' },
  EPIC:        { Icon: Award,        classes: 'bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300',    label: 'Epic' },
  SUBTASK:     { Icon: GitBranch,    classes: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-950 dark:text-cyan-300',            label: 'Subtask' },
  IMPROVEMENT: { Icon: Sparkles,     classes: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',        label: 'Improvement' },
  FEATURE:     { Icon: Zap,          classes: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300',    label: 'Feature' },
  TEST:        { Icon: FlaskConical, classes: 'bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300',    label: 'Test' },
};

const PRIORITY_META: Record<string, { dot: string; label: string }> = {
  HIGHEST: { dot: 'bg-red-500',    label: 'Highest' },
  HIGH:    { dot: 'bg-orange-500', label: 'High' },
  MEDIUM:  { dot: 'bg-amber-500',  label: 'Medium' },
  LOW:     { dot: 'bg-sky-500',    label: 'Low' },
  LOWEST:  { dot: 'bg-slate-400',  label: 'Lowest' },
};

function getTypeMeta(t: string | undefined) {
  return TYPE_META[(t ?? '').toUpperCase()] ?? TYPE_META.TASK!;
}

function getPriorityMeta(p: string | undefined) {
  return PRIORITY_META[(p ?? '').toUpperCase()] ?? PRIORITY_META.MEDIUM!;
}

// Smart deadline chip. Returns null when the task has no DueDate, otherwise
// classifies into: overdue (past) / due soon (≤24h) / due today / due-this-week
// / scheduled. The label includes time-of-day only when the deadline isn't at
// midnight UTC — most users will want to see "Tue, 5:00 PM" but a card with
// just a date should stay tidy.
function formatDeadline(dueIso: string): { label: string; cls: string; title: string } | null {
  const t = new Date(dueIso).getTime();
  if (!Number.isFinite(t)) return null;
  const now = Date.now();
  const diffMin = Math.round((t - now) / 60_000);
  const due = new Date(t);

  const hasTime = due.getHours() !== 0 || due.getMinutes() !== 0;
  const dateLabel = formatShortDate(due);
  const timeLabel = formatShortTime(due);
  const fullLabel = hasTime ? `${dateLabel}, ${timeLabel}` : dateLabel;
  const tooltip = `Due ${formatDateTime(due)}`;

  // Buckets in order of severity:
  if (diffMin < 0) {
    const overdueMin = -diffMin;
    const short = overdueMin < 60   ? `${overdueMin}m overdue`
                : overdueMin < 1440 ? `${Math.round(overdueMin / 60)}h overdue`
                                    : `${Math.round(overdueMin / 1440)}d overdue`;
    return { label: short, cls: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300', title: tooltip };
  }
  if (diffMin <= 24 * 60) {
    return { label: hasTime ? `Due ${timeLabel}` : 'Due today',
             cls: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
             title: tooltip };
  }
  if (diffMin <= 7 * 24 * 60) {
    return { label: `Due ${fullLabel}`,
             cls: 'bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300',
             title: tooltip };
  }
  return { label: fullLabel,
           cls: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
           title: tooltip };
}

export function TaskCard({ task, assignees = [], deleteTask, onOpen }: Props) {
  const taskId   = String(task.Id ?? task.id ?? '');
  const title    = task.Title ?? task.title ?? task.content ?? '';
  const issueKey = task.IssueKey ?? task.issueKey ?? null;
  const type     = (task.Type ?? task.type ?? 'TASK').toString();
  const priority = (task.Priority ?? task.priority ?? 'MEDIUM').toString();
  const points   = task.StoryPoints ?? task.storyPoints ?? null;
  const dueDate  = (task.DueDate ?? task.dueDate) as string | null | undefined;
  const deadline = dueDate ? formatDeadline(dueDate) : null;

  const typeMeta     = getTypeMeta(type);
  const priorityMeta = getPriorityMeta(priority);
  const TypeIcon     = typeMeta.Icon;

  const {
    setNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: taskId,
    data: { type: 'Task', task },
  });

  const style = {
    transition,
    transform: CSS.Transform.toString(transform),
  };

  if (isDragging) {
    return (
      <div
        ref={setNodeRef}
        style={style}
        className="h-24 rounded-lg border-2 border-dashed border-primary/40 bg-primary/5"
        aria-hidden="true"
      />
    );
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      onClick={(e) => {
        // Ignore clicks that originated on the delete button or drag handle
        if ((e.target as HTMLElement).closest('[data-card-action]')) return;
        onOpen?.(task);
      }}
      className={cn(
        'group relative flex flex-col gap-2 rounded-lg border border-border bg-card p-3',
        'shadow-xs transition-all hover:shadow-md hover:border-primary/30',
        'cursor-pointer focus-within:ring-2 focus-within:ring-primary/40',
      )}
    >
      {/* Top row: type icon + delete */}
      <div className="flex items-start justify-between gap-2">
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
            typeMeta.classes,
          )}
          aria-label={`Issue type: ${typeMeta.label}`}
        >
          <TypeIcon className="size-3" />
          {typeMeta.label}
        </span>

        <button
          type="button"
          data-card-action
          onClick={(e) => { e.stopPropagation(); deleteTask(taskId); }}
          className="opacity-0 group-hover:opacity-100 rounded-sm p-1 text-muted-foreground transition-opacity hover:bg-destructive/10 hover:text-destructive focus:opacity-100"
          aria-label={`Delete ${title}`}
        >
          <X className="size-3.5" />
        </button>
      </div>

      {/* Title */}
      <div className="text-sm font-medium leading-snug text-foreground line-clamp-2">
        {title || <span className="italic text-muted-foreground">(untitled)</span>}
      </div>

      {/* Deadline chip — only rendered when a due date is set. Colours mean:
          red = overdue, amber = within 24h / 7d, neutral = scheduled later. */}
      {deadline && (
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold w-fit',
            deadline.cls,
          )}
          title={deadline.title}
          aria-label={deadline.title}
        >
          <Clock className="size-3" /> {deadline.label}
        </span>
      )}

      {/* Bottom row: issue key + assignees + priority + story points + drag handle */}
      <div className="mt-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <div className="flex items-center gap-2 min-w-0">
          {issueKey && (
            <span className="font-mono text-[11px] text-muted-foreground/80 truncate">
              {issueKey}
            </span>
          )}
          <AssigneeStack assignees={assignees} />
        </div>

        <div className="flex items-center gap-1.5">
          {points != null && (
            <Badge variant="outline" size="xs" appearance="outline" className="font-mono">
              {points}
            </Badge>
          )}
          <span
            className={cn('inline-block size-2 rounded-full', priorityMeta.dot)}
            aria-label={`Priority: ${priorityMeta.label}`}
            title={`Priority: ${priorityMeta.label}`}
          />
          <button
            type="button"
            data-card-action
            {...attributes}
            {...listeners}
            onClick={(e) => e.stopPropagation()}
            className="ml-0.5 cursor-grab text-muted-foreground/60 hover:text-muted-foreground active:cursor-grabbing"
            aria-label={`Drag ${title}`}
          >
            <GripVertical className="size-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
