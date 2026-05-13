'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  ChevronLeft, ChevronRight, ChevronDown, Crosshair, Maximize2,
  Bug, Bookmark, CheckSquare, Award, GitBranch, Sparkles, Zap, FlaskConical,
  AlertTriangle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useStore } from '@/store/useStore';

// ─── Types (matches the API shape) ───────────────────────────────────────────

export interface GanttItem {
  id: string;
  issueKey: string;
  title: string;
  type: string;
  status: string;
  priority: string;
  startDate: string | null;
  dueDate: string | null;
  epicId: string | null;
  childCount: number;
  childDoneCount: number;
}

export interface GanttDep {
  taskId: string;
  dependsOn: string;
  type: string;
}

interface Props {
  items: GanttItem[];
  deps?: GanttDep[];
  onUpdateDates?: (taskId: string, startDate: string | null, dueDate: string | null) => void;
}

// ─── Zoom configuration ──────────────────────────────────────────────────────

type ZoomLevel = 'day' | 'week' | 'month';

const ZOOM_CFG = {
  day:   { label: 'Day',   colPx: 36,  unitDays: 1,  padDays: 14  },
  week:  { label: 'Week',  colPx: 70,  unitDays: 7,  padDays: 28  },
  month: { label: 'Month', colPx: 120, unitDays: 30, padDays: 90  },
} as const satisfies Record<string, { label: string; colPx: number; unitDays: number; padDays: number }>;

const ROW_H        = 38;
const LABEL_W      = 280;
const HEADER_H     = 56;

// ─── Date helpers ────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function startOfDay(d: Date): Date {
  const r = new Date(d); r.setHours(0, 0, 0, 0); return r;
}
function today0(): Date { return startOfDay(new Date()); }

function addDays(d: Date, n: number): Date {
  const r = new Date(d); r.setDate(r.getDate() + n); return r;
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / DAY_MS);
}

function parseDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  return startOfDay(d);
}

function toIsoDate(d: Date): string {
  return d.toISOString().split('T')[0]!;
}

function isWeekend(d: Date): boolean {
  return d.getDay() === 0 || d.getDay() === 6;
}

// Build a list of column starts spanning [rangeStart, rangeEnd] for the chosen zoom.
function buildSlots(zoom: ZoomLevel, rangeStart: Date, rangeEnd: Date): Date[] {
  const slots: Date[] = [];
  if (zoom === 'day') {
    const cur = new Date(rangeStart);
    while (cur <= rangeEnd) { slots.push(new Date(cur)); cur.setDate(cur.getDate() + 1); }
  } else if (zoom === 'week') {
    // Start from the Monday of the week containing rangeStart.
    const cur = new Date(rangeStart);
    const dow = cur.getDay();
    cur.setDate(cur.getDate() - (dow === 0 ? 6 : dow - 1));
    while (cur <= rangeEnd) { slots.push(new Date(cur)); cur.setDate(cur.getDate() + 7); }
  } else {
    // month: start of each calendar month.
    const cur = new Date(rangeStart);
    cur.setDate(1);
    while (cur <= rangeEnd) { slots.push(new Date(cur)); cur.setMonth(cur.getMonth() + 1); }
  }
  return slots;
}

// Primary label per column (Day=`5`, Week=`Sep 8`, Month=`Sep`).
function slotPrimary(d: Date, zoom: ZoomLevel): string {
  if (zoom === 'day')   return String(d.getDate());
  if (zoom === 'week')  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  return MONTHS[d.getMonth()]!;
}

// Whether this slot starts a new "epoch" (month for day/week, year for month).
// Used to add divider lines and group-headers.
function isEpochBoundary(d: Date, prev: Date | undefined, zoom: ZoomLevel): boolean {
  if (!prev) return true;
  if (zoom === 'day' || zoom === 'week') return d.getMonth() !== prev.getMonth();
  return d.getFullYear() !== prev.getFullYear();
}

function epochLabel(d: Date, zoom: ZoomLevel): string {
  if (zoom === 'day' || zoom === 'week') return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  return String(d.getFullYear());
}

// ─── Type icons + colours (matches TaskCard) ─────────────────────────────────

const TYPE_META: Record<string, { Icon: typeof Bug; barCls: string; iconCls: string; label: string }> = {
  EPIC:        { Icon: Award,        barCls: 'bg-purple-500',  iconCls: 'text-purple-500',  label: 'Epic' },
  STORY:       { Icon: Bookmark,     barCls: 'bg-green-500',   iconCls: 'text-green-500',   label: 'Story' },
  TASK:        { Icon: CheckSquare,  barCls: 'bg-blue-500',    iconCls: 'text-blue-500',    label: 'Task' },
  BUG:         { Icon: Bug,          barCls: 'bg-red-500',     iconCls: 'text-red-500',     label: 'Bug' },
  SUBTASK:     { Icon: GitBranch,    barCls: 'bg-cyan-500',    iconCls: 'text-cyan-500',    label: 'Subtask' },
  IMPROVEMENT: { Icon: Sparkles,     barCls: 'bg-amber-500',   iconCls: 'text-amber-500',   label: 'Improvement' },
  FEATURE:     { Icon: Zap,          barCls: 'bg-indigo-500',  iconCls: 'text-indigo-500',  label: 'Feature' },
  TEST:        { Icon: FlaskConical, barCls: 'bg-orange-500',  iconCls: 'text-orange-500',  label: 'Test' },
};

function getTypeMeta(t: string | undefined) {
  return TYPE_META[(t ?? '').toUpperCase()] ?? TYPE_META.TASK!;
}

// ─── Drag state ───────────────────────────────────────────────────────────────

interface DragState {
  taskId: string;
  handle: 'left' | 'right' | 'move';
  startX: number;
  origStart: Date | null;
  origEnd:   Date | null;
  pxPerDay:  number;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function GanttChart({ items, deps = [], onUpdateDates }: Props) {
  // Zoom + scroll position live in the store so navigating away and back
  // preserves the user's viewport instead of snapping to today.
  const zoom               = useStore((s) => s.roadmapZoom);
  const setZoom            = useStore((s) => s.setRoadmapZoom);
  const savedScrollLeft    = useStore((s) => s.roadmapScrollLeft);
  const setSavedScrollLeft = useStore((s) => s.setRoadmapScrollLeft);

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [overrides, setOverrides] = useState<Record<string, { startDate?: string; dueDate?: string }>>({});
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragRef   = useRef<DragState | null>(null);
  const didRestoreRef = useRef(false);

  const today = today0();
  const cfg   = ZOOM_CFG[zoom];

  // ── Dynamic range: span all data + zoom-dependent padding, fall back to a
  // sensible window around today when the project has no scheduled work yet.
  const range = useMemo(() => {
    const dates: number[] = [];
    for (const it of items) {
      const s = parseDate(it.startDate);
      const e = parseDate(it.dueDate);
      if (s) dates.push(s.getTime());
      if (e) dates.push(e.getTime());
    }
    let dataMin = dates.length ? new Date(Math.min(...dates)) : addDays(today, -7);
    let dataMax = dates.length ? new Date(Math.max(...dates)) : addDays(today, 30);
    // Always include today so the today-line is visible
    if (today < dataMin) dataMin = new Date(today);
    if (today > dataMax) dataMax = new Date(today);
    return {
      rangeStart: addDays(dataMin, -cfg.padDays),
      rangeEnd:   addDays(dataMax,  cfg.padDays),
    };
  }, [items, zoom, today.getTime()]); // eslint-disable-line react-hooks/exhaustive-deps

  const slots    = useMemo(() => buildSlots(zoom, range.rangeStart, range.rangeEnd), [zoom, range]);
  const pxPerDay = cfg.colPx / cfg.unitDays;
  const totalW   = slots.length * cfg.colPx;
  const todayPx  = daysBetween(range.rangeStart, today) * pxPerDay;

  // ── Group rows by epic for hierarchical display ───────────────────────────
  // Epics first (with their children indented below), then orphan items.
  const rowList = useMemo(() => {
    const epics    = items.filter((i) => i.type === 'EPIC');
    const epicIds  = new Set(epics.map((e) => e.id));
    const children = new Map<string, GanttItem[]>();
    const orphans: GanttItem[] = [];

    for (const it of items) {
      if (it.type === 'EPIC') continue;
      if (it.epicId && epicIds.has(it.epicId)) {
        const arr = children.get(it.epicId) ?? [];
        arr.push(it);
        children.set(it.epicId, arr);
      } else {
        orphans.push(it);
      }
    }

    const rows: { item: GanttItem; depth: number; isEpic: boolean; childrenCount: number }[] = [];
    for (const epic of epics) {
      const kids = children.get(epic.id) ?? [];
      rows.push({ item: epic, depth: 0, isEpic: true, childrenCount: kids.length });
      if (!collapsed[epic.id]) {
        for (const kid of kids) rows.push({ item: kid, depth: 1, isEpic: false, childrenCount: 0 });
      }
    }
    for (const o of orphans) rows.push({ item: o, depth: 0, isEpic: false, childrenCount: 0 });
    return rows;
  }, [items, collapsed]);

  // ── Scroll position management ────────────────────────────────────────────
  // - On first mount, restore the saved scrollLeft (if any) so a page navigation
  //   round-trip keeps the user's viewport intact.
  // - Only auto-scroll-to-today when the user explicitly changes zoom or hits
  //   the Today button — not on mount.
  const scrollToToday = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const next = Math.max(0, todayPx - el.clientWidth / 2 + LABEL_W);
    el.scrollLeft = next;
    setSavedScrollLeft(next);
  }, [todayPx, setSavedScrollLeft]);

  // Restore once per mount. The flag guards against the items/range memo
  // recomputing and clobbering the restored position.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || didRestoreRef.current) return;
    if (savedScrollLeft > 0 && savedScrollLeft <= el.scrollWidth) {
      el.scrollLeft = savedScrollLeft;
    } else {
      // First-ever load — centre on today.
      el.scrollLeft = Math.max(0, todayPx - el.clientWidth / 2 + LABEL_W);
    }
    didRestoreRef.current = true;
  }, [totalW]); // eslint-disable-line react-hooks/exhaustive-deps

  // Persist scroll position as the user pans. Debounced via rAF coalescing so
  // we don't write to the store on every scroll event.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        setSavedScrollLeft(el.scrollLeft);
      });
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [setSavedScrollLeft]);

  const scrollBy = (deltaPx: number) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: deltaPx, behavior: 'smooth' });
  };

  // Explicit zoom change → re-centre on today, since the px positions of all
  // bars shift and the previously-visible window no longer matches reality.
  const changeZoom = (z: ZoomLevel) => {
    setZoom(z);
    requestAnimationFrame(() => scrollToToday());
  };

  // ── Fit-to-data: scroll so the earliest data point is left-aligned ────────
  const scrollToFit = () => {
    const el = scrollRef.current;
    if (!el) return;
    const firstDataDay = items.reduce<Date | null>((acc, it) => {
      const s = parseDate(it.startDate) ?? parseDate(it.dueDate);
      if (!s) return acc;
      if (!acc || s < acc) return s;
      return acc;
    }, null);
    if (!firstDataDay) { scrollToToday(); return; }
    const px = daysBetween(range.rangeStart, firstDataDay) * pxPerDay;
    el.scrollLeft = Math.max(0, px - cfg.colPx);
  };

  // ── Drag (resize + move bars) ─────────────────────────────────────────────
  useEffect(() => {
    function onMove(e: MouseEvent) {
      const ds = dragRef.current;
      if (!ds) return;
      const deltaDays = Math.round((e.clientX - ds.startX) / ds.pxPerDay);
      let newStart = ds.origStart ? new Date(ds.origStart) : null;
      let newEnd   = ds.origEnd   ? new Date(ds.origEnd)   : null;
      if (ds.handle === 'move') {
        if (newStart) newStart = addDays(newStart, deltaDays);
        if (newEnd)   newEnd   = addDays(newEnd,   deltaDays);
      } else if (ds.handle === 'left') {
        if (newStart) newStart = addDays(newStart, deltaDays);
      } else {
        if (newEnd) newEnd = addDays(newEnd, deltaDays);
      }
      // Keep ordered
      if (newStart && newEnd && newStart > newEnd) {
        if (ds.handle === 'left')  newStart = new Date(newEnd);
        else                       newEnd   = new Date(newStart);
      }
      setOverrides((prev) => ({
        ...prev,
        [ds.taskId]: {
          startDate: newStart ? toIsoDate(newStart) : undefined,
          dueDate:   newEnd   ? toIsoDate(newEnd)   : undefined,
        },
      }));
    }
    function onUp() {
      const ds = dragRef.current;
      if (!ds) return;
      dragRef.current = null;
      const ov = overrides[ds.taskId];
      if (ov && onUpdateDates) onUpdateDates(ds.taskId, ov.startDate ?? null, ov.dueDate ?? null);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup',   onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup',   onUp);
    };
  }, [overrides, onUpdateDates]);

  function startDrag(e: React.MouseEvent, item: GanttItem, handle: DragState['handle']) {
    e.stopPropagation();
    e.preventDefault();
    const ov = overrides[item.id];
    dragRef.current = {
      taskId: item.id, handle, startX: e.clientX, pxPerDay,
      origStart: parseDate(ov?.startDate ?? item.startDate),
      origEnd:   parseDate(ov?.dueDate   ?? item.dueDate),
    };
  }

  // ── Bar geometry (handles items with only-start or only-due dates) ───────
  function barGeom(item: GanttItem): { left: number; width: number } | null {
    const ov = overrides[item.id];
    const sd = parseDate(ov?.startDate ?? item.startDate);
    const ed = parseDate(ov?.dueDate   ?? item.dueDate);
    const s  = sd ?? ed;
    const e  = ed ?? sd;
    if (!s || !e) return null;
    const left  = daysBetween(range.rangeStart, s) * pxPerDay;
    const width = Math.max(cfg.colPx * 0.4, daysBetween(s, e) * pxPerDay);
    return { left, width };
  }

  // ── Header epoch groupings (month/year ribbon above day/week/month cols) ─
  const epochRibbon = useMemo(() => {
    const out: { label: string; left: number; width: number }[] = [];
    let groupStart = 0;
    let prev: Date | undefined;
    slots.forEach((d, i) => {
      if (i === 0) { prev = d; return; }
      if (isEpochBoundary(d, prev, zoom)) {
        out.push({
          label: epochLabel(prev!, zoom),
          left:  groupStart * cfg.colPx,
          width: (i - groupStart) * cfg.colPx,
        });
        groupStart = i;
      }
      prev = d;
    });
    if (slots.length) {
      out.push({
        label: epochLabel(slots[slots.length - 1]!, zoom),
        left:  groupStart * cfg.colPx,
        width: (slots.length - groupStart) * cfg.colPx,
      });
    }
    return out;
  }, [slots, zoom, cfg.colPx]);

  return (
    <div className="flex h-full flex-col bg-card text-sm">
      {/* ── Toolbar ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <div className="inline-flex items-center gap-0.5 rounded-md border border-border bg-background p-0.5">
          <Button
            size="sm" variant="ghost"
            className="h-7 px-2"
            onClick={() => scrollBy(-Math.max(cfg.colPx * 4, 240))}
            aria-label="Scroll back"
            title="Scroll back"
          ><ChevronLeft className="size-3.5" /></Button>
          <Button
            size="sm" variant="ghost"
            className="h-7 gap-1.5 px-2 text-xs"
            onClick={scrollToToday}
            title="Jump to today"
          ><Crosshair className="size-3.5" /> Today</Button>
          <Button
            size="sm" variant="ghost"
            className="h-7 px-2"
            onClick={() => scrollBy(Math.max(cfg.colPx * 4, 240))}
            aria-label="Scroll forward"
            title="Scroll forward"
          ><ChevronRight className="size-3.5" /></Button>
        </div>

        <div className="inline-flex rounded-md border border-border bg-background p-0.5">
          {(['day', 'week', 'month'] as ZoomLevel[]).map((z) => (
            <button
              key={z}
              type="button"
              onClick={() => changeZoom(z)}
              className={cn(
                'h-7 px-3 text-xs rounded transition-colors',
                zoom === z
                  ? 'bg-primary text-primary-foreground font-medium'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted',
              )}
              aria-pressed={zoom === z}
            >
              {ZOOM_CFG[z].label}
            </button>
          ))}
        </div>

        <Button
          size="sm" variant="outline"
          className="h-7 gap-1.5 px-2 text-xs"
          onClick={scrollToFit}
          title="Scroll to earliest data point"
        ><Maximize2 className="size-3.5" /> Fit</Button>

        <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          {(['EPIC','STORY','TASK','BUG'] as const).map((t) => {
            const m = TYPE_META[t]!;
            return (
              <span key={t} className="inline-flex items-center gap-1.5">
                <span className={cn('size-2 rounded-sm', m.barCls)} aria-hidden="true" />
                {m.label}
              </span>
            );
          })}
        </div>
      </div>

      {/* ── Chart scroll area ───────────────────────────────────────────── */}
      <div
        ref={scrollRef}
        className="relative flex-1 overflow-auto"
        style={{ contain: 'paint' }}
      >
        {/* Header (sticky top) ─────────────────────────────────────────── */}
        <div
          className="sticky top-0 z-30 flex border-b-2 border-border bg-muted/40 backdrop-blur"
          style={{ height: HEADER_H }}
        >
          <div
            className="sticky left-0 z-40 flex items-center border-r border-border bg-muted/60 px-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
            style={{ width: LABEL_W, minWidth: LABEL_W }}
          >
            Issue
          </div>
          <div className="relative" style={{ width: totalW, minWidth: totalW }}>
            {/* Epoch ribbon */}
            <div className="relative h-6 border-b border-border/60">
              {epochRibbon.map((g, i) => (
                <div
                  key={i}
                  className="absolute top-0 flex h-full items-center border-r border-border/60 px-2 text-[11px] font-semibold text-foreground"
                  style={{ left: g.left, width: g.width }}
                >
                  {g.label}
                </div>
              ))}
            </div>
            {/* Slot row */}
            <div className="relative" style={{ height: HEADER_H - 24 }}>
              {slots.map((d, i) => {
                const isTodaySlot = daysBetween(today, d) === 0
                  || (zoom === 'week' && daysBetween(today, d) >= 0 && daysBetween(today, d) < 7)
                  || (zoom === 'month' && today.getMonth() === d.getMonth() && today.getFullYear() === d.getFullYear());
                const isWk = zoom === 'day' && isWeekend(d);
                return (
                  <div
                    key={i}
                    className={cn(
                      'absolute top-0 flex h-full items-center justify-center border-r border-border/40 text-[11px]',
                      isTodaySlot ? 'bg-primary/10 font-semibold text-primary' :
                      isWk        ? 'bg-muted/40 text-muted-foreground' :
                                    'text-muted-foreground',
                    )}
                    style={{ left: i * cfg.colPx, width: cfg.colPx }}
                  >
                    {slotPrimary(d, zoom)}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Rows ────────────────────────────────────────────────────────── */}
        {rowList.length === 0 ? (
          <div className="flex h-40 items-center justify-center text-xs text-muted-foreground">
            No scheduled items in range.
          </div>
        ) : (
          <div className="relative">
            {rowList.map(({ item, depth, isEpic, childrenCount }) => {
              const geom = barGeom(item);
              const meta = getTypeMeta(item.type);
              const Icon = meta.Icon;
              const progressPct = isEpic && item.childCount > 0
                ? Math.round((item.childDoneCount / item.childCount) * 100)
                : null;
              const overflowLeft  = geom !== null && geom.left + geom.width < (scrollRef.current?.scrollLeft ?? 0);
              const overflowRight = geom !== null && geom.left > (scrollRef.current?.scrollLeft ?? 0) + (scrollRef.current?.clientWidth ?? 0);
              const isCollapsed = collapsed[item.id];

              return (
                <div
                  key={item.id}
                  className="group flex border-b border-border/60 hover:bg-muted/30"
                  style={{ minHeight: ROW_H }}
                >
                  {/* Sticky label column */}
                  <div
                    className="sticky left-0 z-20 flex items-center gap-2 border-r border-border bg-card px-3"
                    style={{ width: LABEL_W, minWidth: LABEL_W, paddingLeft: 12 + depth * 16 }}
                  >
                    {isEpic && childrenCount > 0 ? (
                      <button
                        type="button"
                        onClick={() => setCollapsed((p) => ({ ...p, [item.id]: !p[item.id] }))}
                        className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                        aria-label={isCollapsed ? 'Expand children' : 'Collapse children'}
                      >
                        <ChevronDown className={cn('size-3.5 transition-transform', isCollapsed && '-rotate-90')} />
                      </button>
                    ) : (
                      <span className="size-3.5 shrink-0" />
                    )}
                    <Icon className={cn('size-3.5 shrink-0', meta.iconCls)} />
                    <span className="font-mono text-[10px] shrink-0 text-muted-foreground">{item.issueKey}</span>
                    <span className={cn('truncate text-xs', isEpic && 'font-semibold')}>{item.title}</span>
                    {isEpic && progressPct !== null && (
                      <span className="ml-auto shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                        {progressPct}%
                      </span>
                    )}
                  </div>

                  {/* Timeline cell */}
                  <div
                    className="relative shrink-0"
                    style={{ width: totalW, minWidth: totalW, minHeight: ROW_H }}
                  >
                    {/* Column backgrounds (light grid + weekends + today highlight) */}
                    {slots.map((d, i) => {
                      const isWk    = zoom === 'day' && isWeekend(d);
                      const isToday = daysBetween(today, d) === 0;
                      return (
                        <div
                          key={i}
                          className={cn(
                            'absolute top-0 bottom-0 border-r border-border/30',
                            isToday ? 'bg-primary/[0.04]' : isWk ? 'bg-muted/30' : '',
                          )}
                          style={{ left: i * cfg.colPx, width: cfg.colPx }}
                          aria-hidden="true"
                        />
                      );
                    })}

                    {/* Today line */}
                    <div
                      className="pointer-events-none absolute top-0 bottom-0 z-10 w-px bg-primary/60"
                      style={{ left: todayPx }}
                      aria-hidden="true"
                    />

                    {/* Bar */}
                    {geom ? (
                      <div
                        role="button"
                        tabIndex={0}
                        onMouseDown={(e) => startDrag(e, item, 'move')}
                        className={cn(
                          'absolute top-1/2 -translate-y-1/2 z-20 flex items-center overflow-hidden rounded-md text-[11px] font-medium text-white shadow-sm cursor-grab active:cursor-grabbing',
                          'transition-[filter] hover:brightness-110',
                          isEpic ? 'h-7 ring-1 ring-white/30' : 'h-5',
                          meta.barCls,
                        )}
                        style={{ left: geom.left, width: geom.width }}
                        title={`${item.issueKey} — ${item.title}`}
                      >
                        {/* Progress fill for epics */}
                        {progressPct !== null && (
                          <div
                            className="absolute inset-y-0 left-0 bg-white/25"
                            style={{ width: `${progressPct}%` }}
                            aria-hidden="true"
                          />
                        )}
                        {/* Left resize handle */}
                        <div
                          onMouseDown={(e) => startDrag(e, item, 'left')}
                          className="absolute inset-y-0 left-0 z-10 w-1.5 cursor-ew-resize bg-white/0 hover:bg-white/40"
                          aria-label="Resize start date"
                        />
                        <span className="relative z-[1] truncate px-2">
                          {item.title}
                        </span>
                        {/* Right resize handle */}
                        <div
                          onMouseDown={(e) => startDrag(e, item, 'right')}
                          className="absolute inset-y-0 right-0 z-10 w-1.5 cursor-ew-resize bg-white/0 hover:bg-white/40"
                          aria-label="Resize due date"
                        />
                      </div>
                    ) : (
                      <span className="absolute left-3 top-1/2 z-10 -translate-y-1/2 inline-flex items-center gap-1 text-[10px] text-muted-foreground/70">
                        <AlertTriangle className="size-3" /> no dates
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
