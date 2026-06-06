'use client';

import { useMemo, useSyncExternalStore } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatMonthYear } from '@/lib/date';
import { useLiveTasks, buildAccepts } from '@/lib/realtime/useLiveTasks';
import type { LiveScopeProp } from '@/components/views/view-surface';
import { taskFieldValue } from './field-options';
import type { ViewTaskPageResult } from '@/server/queries/views';
import type { Task } from '@/server/queries/normalize-task';
import type { CustomField, FieldRef, SavedView } from '@projectflow/types';

interface Props {
  /** Paged tasks for the active view. Null when no view is active (handled upstream). */
  taskPage: ViewTaskPageResult | null;
  /** The active saved view — config.dateField drives day placement. */
  activeView: SavedView;
  /** The scope's custom fields (kept for parity / taskFieldValue resolution). */
  customFields?: CustomField[];
  /** Live-subscription scope (created/updated/deleted), resolved SSR in the page. */
  live: LiveScopeProp;
}

// Calendar v1 keys placement on the task's due date by default.
const DEFAULT_DATE_FIELD: FieldRef = { kind: 'builtin', key: 'dueDate' };

/**
 * Locale-correct short weekday labels for a Sunday-start week (the grid is built
 * Sunday → Saturday). 2024-01-07 is a Sunday, so iterating the next 7 local days
 * yields Sun…Sat in the active locale via Intl.DateTimeFormat.
 */
function weekdayLabels(locale: string): string[] {
  const fmt = new Intl.DateTimeFormat(locale, { weekday: 'short' });
  return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(2024, 0, 7 + i)));
}

// ── Local date helpers ──────────────────────────────────────────────────────────
// We work in LOCAL calendar terms (the grid is a wall-calendar). YYYY-MM-DD keys
// are derived from the *local* Y/M/D so a task chip lands on the day the user sees.

/** Zero-padded "YYYY-MM" for a Date's local year+month. */
function toMonthParam(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Zero-padded "YYYY-MM-DD" for a Date's local year+month+day. */
function toDayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Parse a "YYYY-MM" param into a local Date at the 1st of that month, or null. */
function parseMonthParam(param: string | null): Date | null {
  if (!param) return null;
  const m = /^(\d{4})-(\d{2})$/.exec(param);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return new Date(year, month - 1, 1);
}

/**
 * Parse a task's date value (an ISO string, a date-only string, or null) into a
 * local "YYYY-MM-DD" key, or null when absent/unparseable. Date-only strings
 * (e.g. "2026-06-15") are read as a local calendar day to avoid a UTC-shift that
 * would bump the chip to the previous day in negative-offset timezones.
 */
function dayKeyForValue(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnly) {
    return `${dateOnly[1]}-${dateOnly[2]}-${dateOnly[3]}`;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return toDayKey(parsed);
}

interface DayCell {
  date: Date;
  key: string; // YYYY-MM-DD
  inMonth: boolean;
  tasks: Task[];
}

/**
 * Build the 6×7 (max) week grid for `monthStart`. The grid is padded to whole
 * weeks: leading days from the previous month and trailing days from the next so
 * every row has 7 cells. Tasks are bucketed by their resolved day key; only
 * in-month days actually show chips (out-of-month padding cells stay empty).
 */
function buildWeeks(monthStart: Date, tasksByDay: Map<string, Task[]>): DayCell[][] {
  const year = monthStart.getFullYear();
  const month = monthStart.getMonth();

  // First grid cell = the Sunday on/before the 1st.
  const gridStart = new Date(year, month, 1);
  gridStart.setDate(gridStart.getDate() - gridStart.getDay());

  // Last grid cell = the Saturday on/after the last day of the month.
  const monthEnd = new Date(year, month + 1, 0);
  const gridEnd = new Date(year, month, monthEnd.getDate());
  gridEnd.setDate(gridEnd.getDate() + (6 - gridEnd.getDay()));

  const weeks: DayCell[][] = [];
  const current = new Date(gridStart);
  while (current <= gridEnd) {
    const week: DayCell[] = [];
    for (let i = 0; i < 7; i++) {
      const key = toDayKey(current);
      const inMonth = current.getMonth() === month;
      week.push({
        date: new Date(current),
        key,
        inMonth,
        tasks: inMonth ? tasksByDay.get(key) ?? [] : [],
      });
      current.setDate(current.getDate() + 1);
    }
    weeks.push(week);
  }
  return weeks;
}

// Client-only flag without a setState-in-effect: getServerSnapshot returns false
// (matching SSR + the initial hydration render), getSnapshot returns true on the
// client. Used to defer the `new Date()` "current month" fallback to the browser.
const subscribeNoop = () => () => {};

export function CalendarView({ taskPage, activeView, customFields = [], live }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tr = useTranslations('Views');
  const locale = useLocale();
  const weekdays = useMemo(() => weekdayLabels(locale), [locale]);

  const baseTasks = useMemo(() => taskPage?.tasks ?? [], [taskPage]);
  // Live task events (created/updated/deleted) merged onto the SSR page. Keyed by
  // the resolved owning project (SPACE/LIST/FOLDER) or workspace (EVERYTHING);
  // `buildAccepts` gates which live `created` tasks belong in this surface. A live
  // dueDate change is patched in place, so the chip re-buckets to the new day.
  const tasks = useLiveTasks(
    baseTasks,
    live.projectId ? { projectId: live.projectId } : { workspaceId: live.workspaceId },
    buildAccepts(live.acceptKind, live.listScopeId),
  );
  const dateField = activeView.config.dateField ?? DEFAULT_DATE_FIELD;

  // Hydration safety: the displayed month is parsed from the SSR-stable ?month=
  // param, so server and client first render agree whenever the param is present.
  // When it's ABSENT we default to "current month" — but `new Date()` diverges
  // between the server and the browser, so we gate that fallback behind a mount
  // flag and render a neutral first paint until the client takes over.
  const monthParam = searchParams.get('month');
  const monthFromParam = parseMonthParam(monthParam);
  const mounted = useSyncExternalStore(subscribeNoop, () => true, () => false);

  // The month actually shown. With a valid param this is deterministic; without
  // one we only resolve to the live current month after mount.
  const monthStart = useMemo(() => {
    if (monthFromParam) return monthFromParam;
    if (!mounted) return null;
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  }, [monthFromParam, mounted]);

  // Bucket the fetched page's tasks by their resolved day key for the date field.
  const tasksByDay = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const t of tasks) {
      // taskFieldValue returns the builtin date value (dueDate/startDate) or null
      // for fields not present on the normalized Task projection — those tasks are
      // simply left unplaced rather than crashing.
      const value = taskFieldValue(t, dateField, customFields);
      const key = dayKeyForValue(value);
      if (!key) continue;
      const arr = map.get(key) ?? [];
      arr.push(t);
      map.set(key, arr);
    }
    return map;
  }, [tasks, dateField, customFields]);

  const weeks = useMemo(
    () => (monthStart ? buildWeeks(monthStart, tasksByDay) : []),
    [monthStart, tasksByDay],
  );

  // Navigate to an adjacent month by updating ?month=, preserving other params
  // (mirrors view-tabs.tsx selectView: clone the params, mutate, push).
  const goToMonth = (target: Date) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('month', toMonthParam(target));
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const shiftMonth = (delta: number) => {
    const base = monthStart ?? new Date();
    goToMonth(new Date(base.getFullYear(), base.getMonth() + delta, 1));
  };

  const monthLabel = monthStart ? formatMonthYear(monthStart) : '';

  return (
    <div
      data-testid="view-body-calendar"
      className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-background"
    >
      {/* Month nav header */}
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="text-sm font-semibold text-foreground" data-testid="calendar-month-label">
          {monthLabel}
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => shiftMonth(-1)}
            data-testid="calendar-prev-month"
            aria-label={tr('prevMonth')}
            className="size-8 p-0"
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => shiftMonth(1)}
            data-testid="calendar-next-month"
            aria-label={tr('nextMonth')}
            className="size-8 p-0"
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>

      {/* Weekday header */}
      <div className="grid grid-cols-7 border-b border-border bg-muted/20">
        {weekdays.map((label, i) => (
          <div
            key={i}
            className="px-2 py-1 text-center text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
          >
            {label}
          </div>
        ))}
      </div>

      {/* Month grid */}
      <div className="flex-1 overflow-auto">
        {weeks.length === 0 ? (
          // Pre-mount neutral paint (no param): nothing to render deterministically.
          <div className="px-3 py-6 text-center text-xs text-muted-foreground">{tr('loading')}</div>
        ) : (
          weeks.map((week, wi) => (
            <div key={wi} className="grid grid-cols-7 border-b border-border/60 last:border-b-0">
              {week.map((cell) => (
                <div
                  key={cell.key}
                  data-testid="calendar-day"
                  data-date={cell.key}
                  data-in-month={cell.inMonth ? 'true' : undefined}
                  className={cn(
                    'flex min-h-24 flex-col gap-1 border-r border-border/60 p-1.5 last:border-r-0',
                    !cell.inMonth && 'bg-muted/20 text-muted-foreground',
                  )}
                >
                  <div className="text-right text-[11px] font-medium tabular-nums">
                    {cell.date.getDate()}
                  </div>
                  <div className="flex flex-col gap-0.5">
                    {cell.tasks.map((t) => (
                      <div
                        key={t.id}
                        data-testid="calendar-task"
                        title={t.title}
                        className="truncate rounded bg-primary/10 px-1.5 py-0.5 text-[11px] text-foreground"
                      >
                        {t.title || <span className="italic text-muted-foreground">{tr('untitled')}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
