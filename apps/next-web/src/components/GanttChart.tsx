'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  ChevronLeft, ChevronRight, ChevronDown, Crosshair, Maximize2,
  Bug, Bookmark, CheckSquare, Award, GitBranch, Sparkles, Zap, FlaskConical,
  AlertTriangle, ArrowLeftCircle, ArrowRightCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useStore } from '@/store/useStore';
import {
  type ZoomLevel, ZOOM_CFG, MONTHS,
  startOfDay, addDays, daysBetween, parseDate, toIsoDate, isWeekend,
  buildSlots, computeRange, dateToPx, barGeometry,
} from './gantt/geometry';

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
  // Open an issue from the timeline. Wired by the page to a TaskDrawer.
  // Click-vs-drag is disambiguated by movement threshold inside the chart.
  onOpenTask?: (item: GanttItem) => void;
}

// ─── Status helpers ──────────────────────────────────────────────────────────
// Workflow status values are workspace-defined free-form strings ('Done',
// 'DONE', 'In Progress', 'In Review', etc.). Reduce to three buckets for bar
// styling so the timeline reads as "what's actually shipping when" rather than
// just "what type of work it is."
type StatusCategory = 'done' | 'in_progress' | 'todo';

function getStatusCategory(s: string | null | undefined): StatusCategory {
  const u = (s ?? '').toString().toUpperCase().replace(/\s+/g, '_');
  if (u === 'DONE' || u.includes('CLOSED') || u.includes('RESOLVED') || u === 'COMPLETE' || u === 'COMPLETED') {
    return 'done';
  }
  if (u.includes('PROGRESS') || u.includes('REVIEW') || u === 'TESTING' || u === 'BLOCKED' || u === 'DOING') {
    return 'in_progress';
  }
  return 'todo';
}

const SHORT_DATE = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
function shortDate(d: Date | null): string {
  return d ? SHORT_DATE.format(d) : '—';
}

// ─── Layout constants ────────────────────────────────────────────────────────
// Zoom config + date/geometry helpers now live in ./gantt/geometry so the
// pixel↔date mapping can be unit-tested in isolation — that mapping is exactly
// where the timeline used to drift in week/month zoom.

const ROW_H    = 38;
const LABEL_W  = 280;
const HEADER_H = 56;

function today0(): Date { return startOfDay(new Date()); }

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
  // Movement guard: only treat as a drag once the cursor leaves a small dead
  // zone. Below the threshold, mouseup is interpreted as a click instead so
  // the bar can double as an "open this issue" target.
  moved: boolean;
  // Authoritative latest dates from this drag. Mutated synchronously inside
  // the move handler so mouseup can commit them without relying on the React
  // `overrides` state having flushed — a render-scheduling race that made
  // short/fast drags occasionally not persist.
  curStart: Date | null;
  curEnd:   Date | null;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function GanttChart({ items, deps = [], onUpdateDates, onOpenTask }: Props) {
  // Zoom + scroll position live in the store so navigating away and back
  // preserves the user's viewport instead of snapping to today.
  const zoom               = useStore((s) => s.roadmapZoom);
  const setZoom            = useStore((s) => s.setRoadmapZoom);
  const savedScrollLeft    = useStore((s) => s.roadmapScrollLeft);
  const setSavedScrollLeft = useStore((s) => s.setRoadmapScrollLeft);

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [overrides, setOverrides] = useState<Record<string, { startDate?: string; dueDate?: string }>>({});
  // Track viewport (scrollLeft + clientWidth) so we can position sticky-style
  // overflow chevrons and decide whether a bar is off-screen. Updated via rAF
  // inside the scroll listener to coalesce work.
  const [viewport, setViewport] = useState({ left: 0, width: 0 });
  // Floating dates+duration label that follows the cursor while dragging.
  const [dragHint, setDragHint] = useState<{ x: number; y: number; text: string } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragRef   = useRef<DragState | null>(null);
  // Last known mouse X during drag, so the rAF-driven autoscroll loop can keep
  // panning even when the mouse is held stationary at the viewport edge.
  const lastMouseXRef    = useRef(0);
  const lastMouseYRef    = useRef(0);
  const autoScrollRafRef = useRef<number | null>(null);
  const didRestoreRef = useRef(false);

  const today = today0();
  const todayMs = today.getTime(); // stable per-day primitive for memo deps
  const cfg   = ZOOM_CFG[zoom];

  // Clear local drag overrides once the server-side items catch up. Without
  // this, an override would keep "winning" over server data forever (forcing
  // the user to refresh to see the canonical state) — and any mismatch
  // between the dragged ISO date and the server's normalized value would be
  // permanently masked.
  useEffect(() => {
    setOverrides((prev) => {
      const ids = Object.keys(prev);
      if (ids.length === 0) return prev;
      const byId = new Map(items.map((it) => [it.id, it]));
      let changed = false;
      const next: typeof prev = {};
      for (const id of ids) {
        const ov = prev[id]!;
        const it = byId.get(id);
        if (it && it.startDate === (ov.startDate ?? null) && it.dueDate === (ov.dueDate ?? null)) {
          changed = true; // drop entry — server matches the override
        } else {
          next[id] = ov;
        }
      }
      return changed ? next : prev;
    });
  }, [items]);

  // ── Dynamic range: span all data + zoom-dependent padding, fall back to a
  // sensible window around today when the project has no scheduled work yet.
  const range = useMemo(
    () => computeRange(items, today, cfg.padDays),
    [items, cfg.padDays, todayMs], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const slots    = useMemo(() => buildSlots(zoom, range.rangeStart, range.rangeEnd), [zoom, range]);
  const pxPerDay = cfg.colPx / cfg.unitDays;
  const totalW   = slots.length * cfg.colPx;
  // Position the today-line through the same slot-interpolated mapping the bars
  // use, so it stays locked to the grid at every zoom.
  const todayPx  = dateToPx(today, slots, cfg.colPx, cfg.unitDays);

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
    // Centre today in the *visible timeline* — the area right of the sticky
    // label column — so it lands mid-screen instead of LABEL_W/2 off to the
    // side. Matches scrollToBar's framing.
    const visibleW = Math.max(0, el.clientWidth - LABEL_W);
    const next = Math.max(0, todayPx - visibleW / 2);
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
      // First-ever load — centre on today within the visible timeline.
      const visibleW = Math.max(0, el.clientWidth - LABEL_W);
      el.scrollLeft = Math.max(0, todayPx - visibleW / 2);
    }
    didRestoreRef.current = true;
  }, [totalW]); // eslint-disable-line react-hooks/exhaustive-deps

  // Persist scroll position as the user pans, and mirror viewport metrics into
  // local state so off-screen-bar overflow chevrons can re-render. Debounced
  // via rAF coalescing so we don't write to the store on every scroll event.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // Seed initial viewport now that the ref is attached.
    setViewport({ left: el.scrollLeft, width: el.clientWidth });
    let raf = 0;
    const sync = () => {
      raf = 0;
      setSavedScrollLeft(el.scrollLeft);
      setViewport({ left: el.scrollLeft, width: el.clientWidth });
    };
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(sync);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    const ro = new ResizeObserver(() => {
      if (raf) return;
      raf = requestAnimationFrame(sync);
    });
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', onScroll);
      ro.disconnect();
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
    const px = dateToPx(firstDataDay, slots, cfg.colPx, cfg.unitDays);
    el.scrollLeft = Math.max(0, px - cfg.colPx);
  };

  // ── Drag (resize + move bars) ─────────────────────────────────────────────
  // Subtle but important: a mousedown that doesn't move beyond DRAG_THRESHOLD
  // is treated as a click (open the issue), not a zero-length drag. That lets
  // the same bar element double as both a draggable schedule handle and a
  // navigation target without breaking either.
  const DRAG_THRESHOLD = 3;
  const AUTOSCROLL_EDGE = 80;
  const AUTOSCROLL_MAX  = 24;
  useEffect(() => {
    function applyDragDelta(ds: DragState, currentX: number) {
      const deltaPx   = currentX - ds.startX;
      const deltaDays = Math.round(deltaPx / ds.pxPerDay);
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
      // Keep ordered: if the user drags an edge past the other edge, clamp.
      if (newStart && newEnd && newStart > newEnd) {
        if (ds.handle === 'left')  newStart = new Date(newEnd);
        else                       newEnd   = new Date(newStart);
      }
      // Synchronous source of truth for mouseup. React state may not have
      // flushed by the time the user releases the mouse on a short drag.
      ds.curStart = newStart;
      ds.curEnd   = newEnd;
      setOverrides((prev) => ({
        ...prev,
        [ds.taskId]: {
          startDate: newStart ? toIsoDate(newStart) : undefined,
          dueDate:   newEnd   ? toIsoDate(newEnd)   : undefined,
        },
      }));
      // Floating tooltip with the dates the user will commit to on release.
      const span = (newStart && newEnd) ? Math.max(1, daysBetween(newStart, newEnd) + 1) : null;
      setDragHint({
        x: lastMouseXRef.current,
        y: lastMouseYRef.current,
        text: `${shortDate(newStart)} → ${shortDate(newEnd)}${span ? ` · ${span}d` : ''}`,
      });
    }

    function tickAutoScroll() {
      const ds = dragRef.current;
      if (!ds) { autoScrollRafRef.current = null; return; }
      const el = scrollRef.current;
      if (!el) { autoScrollRafRef.current = requestAnimationFrame(tickAutoScroll); return; }
      const rect = el.getBoundingClientRect();
      // The label column is sticky on the left, so the *usable* left edge for
      // dragging in the timeline starts at rect.left + LABEL_W.
      const usableLeft  = rect.left + LABEL_W;
      const usableRight = rect.right;
      const x = lastMouseXRef.current;
      let dx = 0;
      if (x < usableLeft + AUTOSCROLL_EDGE) {
        const t = Math.min(1, (usableLeft + AUTOSCROLL_EDGE - x) / AUTOSCROLL_EDGE);
        dx = -AUTOSCROLL_MAX * t;
      } else if (x > usableRight - AUTOSCROLL_EDGE) {
        const t = Math.min(1, (x - (usableRight - AUTOSCROLL_EDGE)) / AUTOSCROLL_EDGE);
        dx = AUTOSCROLL_MAX * t;
      }
      if (dx !== 0) {
        const before = el.scrollLeft;
        el.scrollLeft = Math.max(0, before + dx);
        const applied = el.scrollLeft - before;
        // Shift the drag origin by the same amount so the drag delta keeps
        // growing as we scroll — the mouse hasn't moved but the timeline has.
        if (applied !== 0) {
          ds.startX -= applied;
          applyDragDelta(ds, lastMouseXRef.current);
        }
      }
      autoScrollRafRef.current = requestAnimationFrame(tickAutoScroll);
    }

    function onMove(e: MouseEvent) {
      const ds = dragRef.current;
      if (!ds) return;
      lastMouseXRef.current = e.clientX;
      lastMouseYRef.current = e.clientY;
      if (!ds.moved && Math.abs(e.clientX - ds.startX) >= DRAG_THRESHOLD) {
        ds.moved = true;
      }
      if (!ds.moved) return; // below threshold — treat as potential click
      // applyDragDelta reads lastMouse*Ref for the tooltip position, so the
      // hint follows the cursor (and stays put during edge autoscroll).
      applyDragDelta(ds, e.clientX);
      if (autoScrollRafRef.current === null) {
        autoScrollRafRef.current = requestAnimationFrame(tickAutoScroll);
      }
    }
    function onUp() {
      const ds = dragRef.current;
      if (!ds) return;
      dragRef.current = null;
      if (autoScrollRafRef.current !== null) {
        cancelAnimationFrame(autoScrollRafRef.current);
        autoScrollRafRef.current = null;
      }
      setDragHint(null);
      if (!ds.moved) {
        // Click, not a drag — open the issue. Skip if the gesture started on
        // a resize handle (left/right) to keep handles drag-only.
        if (ds.handle === 'move' && onOpenTask) {
          const it = items.find((x) => x.id === ds.taskId);
          if (it) onOpenTask(it);
        }
        return;
      }
      // Read final dates from the drag state itself, not from React's
      // `overrides`. The latter may be one mousemove behind on quick drags
      // because state updates batch but the mouseup event is synchronous.
      if (onUpdateDates) {
        onUpdateDates(
          ds.taskId,
          ds.curStart ? toIsoDate(ds.curStart) : null,
          ds.curEnd   ? toIsoDate(ds.curEnd)   : null,
        );
      }
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup',   onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup',   onUp);
      if (autoScrollRafRef.current !== null) {
        cancelAnimationFrame(autoScrollRafRef.current);
        autoScrollRafRef.current = null;
      }
    };
    // overrides intentionally NOT in deps — onUp now reads from dragRef, and
    // re-creating listeners on every mousemove was wasteful.
  }, [onUpdateDates, onOpenTask, items]);

  function startDrag(e: React.MouseEvent, item: GanttItem, handle: DragState['handle']) {
    e.stopPropagation();
    e.preventDefault();
    const ov = overrides[item.id];
    lastMouseXRef.current = e.clientX;
    lastMouseYRef.current = e.clientY;
    const origStart = parseDate(ov?.startDate ?? item.startDate);
    const origEnd   = parseDate(ov?.dueDate   ?? item.dueDate);
    dragRef.current = {
      taskId: item.id, handle, startX: e.clientX, pxPerDay,
      origStart, origEnd,
      // Seed cur* with the originals so a sub-threshold drag that still
      // commits (shouldn't happen via the click-vs-drag guard, but defensive)
      // wouldn't NULL out a task's dates.
      curStart: origStart,
      curEnd:   origEnd,
      moved: false,
    };
  }

  // ── Bar geometry (handles items with only-start or only-due dates) ───────
  function barGeom(item: GanttItem): { left: number; width: number } | null {
    const ov = overrides[item.id];
    return barGeometry(
      {
        startDate: ov?.startDate ?? item.startDate,
        dueDate:   ov?.dueDate   ?? item.dueDate,
      },
      slots, cfg.colPx, cfg.unitDays,
    );
  }

  // Human-readable date range for a bar's hover tooltip + a11y label.
  function barDateLabel(item: GanttItem): string | null {
    const ov = overrides[item.id];
    const s = parseDate(ov?.startDate ?? item.startDate);
    const e = parseDate(ov?.dueDate   ?? item.dueDate);
    if (!s && !e) return null;
    if (s && e) {
      const span = Math.max(1, daysBetween(s, e) + 1);
      return `${shortDate(s)} → ${shortDate(e)} · ${span}d`;
    }
    return shortDate(s ?? e);
  }

  // Per-id geometry + row index, used to draw dependency arrows between bars.
  // Items in collapsed epics are absent from rowList so their deps drop out
  // automatically — no need for special-case hiding.
  const geomById = useMemo(() => {
    const m = new Map<string, { left: number; width: number; rowIndex: number }>();
    rowList.forEach((row, i) => {
      const g = barGeom(row.item);
      if (g) m.set(row.item.id, { ...g, rowIndex: i });
    });
    return m;
    // barGeom closes over overrides + slot geometry; list those explicitly.
  }, [rowList, overrides, slots, cfg.colPx, cfg.unitDays]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Scroll a bar into the centre of the visible timeline area. Triggered by
  // the overflow chevrons rendered when a bar is fully off-screen.
  function scrollToBar(geom: { left: number; width: number }) {
    const el = scrollRef.current;
    if (!el) return;
    const visibleW   = Math.max(0, el.clientWidth - LABEL_W);
    const targetLeft = geom.left + geom.width / 2 - visibleW / 2;
    el.scrollTo({ left: Math.max(0, targetLeft), behavior: 'smooth' });
  }

  return (
    <div className="relative flex h-full flex-col bg-card text-sm">
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
              {/* Today pill — anchors the today line to a labelled marker so
                  users orient instantly without scanning the slot ribbon. */}
              <div
                className="pointer-events-none absolute z-10 -translate-x-1/2 rounded-sm bg-primary px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-primary-foreground shadow-sm"
                style={{ left: todayPx, bottom: 2 }}
                aria-hidden="true"
              >
                Today
              </div>
            </div>
          </div>
        </div>

        {/* Rows ────────────────────────────────────────────────────────── */}
        {rowList.length === 0 ? (
          <div className="flex h-40 items-center justify-center text-xs text-muted-foreground">
            No scheduled items in range.
          </div>
        ) : (
          <div
            className="relative"
            style={{ width: LABEL_W + totalW, minWidth: LABEL_W + totalW }}
          >
            {/* Dependency arrows overlay. SVG sits above row backgrounds but
                below the bars themselves so it never blocks bar clicks. Each
                arrow goes from the predecessor's right edge to the successor's
                left edge with a simple manhattan elbow. Violated deps (the
                successor starts before the predecessor ends) are dashed red
                so scheduling problems are visible at a glance. */}
            {deps.length > 0 && (
              <svg
                className="pointer-events-none absolute top-0 z-[5]"
                style={{ left: LABEL_W, width: totalW, height: rowList.length * ROW_H }}
                aria-hidden="true"
              >
                <defs>
                  <marker
                    id="gantt-arrow-ok"
                    viewBox="0 0 10 10" refX="9" refY="5"
                    markerWidth="6" markerHeight="6" orient="auto-start-reverse"
                  >
                    <path d="M 0 0 L 10 5 L 0 10 z" className="fill-muted-foreground/70" />
                  </marker>
                  <marker
                    id="gantt-arrow-bad"
                    viewBox="0 0 10 10" refX="9" refY="5"
                    markerWidth="6" markerHeight="6" orient="auto-start-reverse"
                  >
                    <path d="M 0 0 L 10 5 L 0 10 z" className="fill-red-500" />
                  </marker>
                </defs>
                {deps.map((dep, di) => {
                  const a = geomById.get(dep.dependsOn);
                  const b = geomById.get(dep.taskId);
                  if (!a || !b) return null;
                  const y1 = a.rowIndex * ROW_H + ROW_H / 2;
                  const y2 = b.rowIndex * ROW_H + ROW_H / 2;
                  const x1 = a.left + a.width;
                  const x2 = b.left;
                  const violated = x2 < x1;
                  const xm = violated ? x1 + 14 : Math.max(x1 + 8, (x1 + x2) / 2);
                  return (
                    <polyline
                      key={`${dep.taskId}::${dep.dependsOn}::${di}`}
                      points={`${x1},${y1} ${xm},${y1} ${xm},${y2} ${x2},${y2}`}
                      fill="none"
                      strokeWidth={1.5}
                      className={violated ? 'stroke-red-500' : 'stroke-muted-foreground/60'}
                      strokeDasharray={violated ? '4 3' : undefined}
                      markerEnd={violated ? 'url(#gantt-arrow-bad)' : 'url(#gantt-arrow-ok)'}
                    />
                  );
                })}
              </svg>
            )}
            {rowList.map(({ item, depth, isEpic, childrenCount }) => {
              const geom = barGeom(item);
              const meta = getTypeMeta(item.type);
              const Icon = meta.Icon;
              const progressPct = isEpic && item.childCount > 0
                ? Math.round((item.childDoneCount / item.childCount) * 100)
                : null;
              const visibleRight  = viewport.left + Math.max(0, viewport.width - LABEL_W);
              const overflowLeft  = geom !== null && geom.left + geom.width < viewport.left;
              const overflowRight = geom !== null && geom.left > visibleRight;
              const isCollapsed = collapsed[item.id];
              const statusCat   = getStatusCategory(item.status);
              const isDone      = statusCat === 'done';
              const isTodo      = statusCat === 'todo';

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
                    <span className={cn('truncate text-xs', isEpic && 'font-semibold', isDone && 'line-through text-muted-foreground')}>
                      {item.title}
                    </span>
                    <div className="ml-auto flex shrink-0 items-center gap-1.5">
                      {!geom && (
                        <span
                          title="No start or due date — set dates to place on the timeline"
                          className="inline-flex items-center gap-1 rounded bg-amber-100 px-1 py-px text-[9px] font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-300"
                        >
                          <AlertTriangle className="size-2.5" /> No date
                        </span>
                      )}
                      {isEpic && progressPct !== null && (
                        <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                          {progressPct}%
                        </span>
                      )}
                    </div>
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

                    {/* Today line — thicker & more opaque so it reads at a
                        glance even on a busy roadmap. */}
                    <div
                      className="pointer-events-none absolute top-0 bottom-0 z-[8] bg-primary/80"
                      style={{ left: todayPx - 1, width: 2 }}
                      aria-hidden="true"
                    />

                    {/* Bar */}
                    {geom && (
                      <div
                        role="button"
                        tabIndex={0}
                        onMouseDown={(e) => startDrag(e, item, 'move')}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            onOpenTask?.(item);
                          }
                        }}
                        className={cn(
                          'absolute top-1/2 -translate-y-1/2 z-20 flex items-center overflow-hidden rounded-md text-[11px] font-medium text-white shadow-sm cursor-grab active:cursor-grabbing',
                          'transition-[filter,opacity] hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                          isEpic ? 'h-7 ring-1 ring-white/30' : 'h-5',
                          meta.barCls,
                          isDone && 'opacity-55 saturate-50',
                          isTodo && 'opacity-90',
                        )}
                        style={{ left: geom.left, width: geom.width }}
                        title={`${item.issueKey} — ${item.title}${barDateLabel(item) ? `\n${barDateLabel(item)}` : ''}`}
                        aria-label={`${item.issueKey} ${item.title}. Status ${item.status}.${barDateLabel(item) ? ` Scheduled ${barDateLabel(item)}.` : ''} Press Enter to open.`}
                      >
                        {/* Progress fill for epics */}
                        {progressPct !== null && (
                          <div
                            className="absolute inset-y-0 left-0 bg-white/25"
                            style={{ width: `${progressPct}%` }}
                            aria-hidden="true"
                          />
                        )}
                        {/* TODO bars get a subtle diagonal hatch overlay so
                            "not started yet" reads instantly even at a
                            distance — bar colour still encodes type. */}
                        {isTodo && (
                          <div
                            className="pointer-events-none absolute inset-0 bg-[repeating-linear-gradient(45deg,transparent_0_6px,rgba(255,255,255,0.18)_6px_12px)]"
                            aria-hidden="true"
                          />
                        )}
                        {/* Left resize handle */}
                        <div
                          onMouseDown={(e) => startDrag(e, item, 'left')}
                          className="absolute inset-y-0 left-0 z-10 w-1.5 cursor-ew-resize bg-white/0 hover:bg-white/40"
                          aria-label="Resize start date"
                        />
                        <span className={cn('relative z-[1] truncate px-2', isDone && 'line-through')}>
                          {item.title}
                        </span>
                        {/* Right resize handle */}
                        <div
                          onMouseDown={(e) => startDrag(e, item, 'right')}
                          className="absolute inset-y-0 right-0 z-10 w-1.5 cursor-ew-resize bg-white/0 hover:bg-white/40"
                          aria-label="Resize due date"
                        />
                      </div>
                    )}

                    {/* Off-screen-bar chevrons. Positioned at the visible
                        edge of the timeline (just inside the sticky label
                        column on the left, and the scroll-container's right
                        edge on the right) using the tracked viewport, so
                        they stay anchored as the user pans. */}
                    {geom && overflowLeft && (
                      <button
                        type="button"
                        onClick={() => scrollToBar(geom)}
                        title={`${item.issueKey} is to the left — click to jump`}
                        className="absolute top-1/2 z-[15] inline-flex size-5 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow hover:text-foreground"
                        style={{ left: viewport.left + 4 }}
                      >
                        <ArrowLeftCircle className="size-3.5" />
                      </button>
                    )}
                    {geom && overflowRight && (
                      <button
                        type="button"
                        onClick={() => scrollToBar(geom)}
                        title={`${item.issueKey} is to the right — click to jump`}
                        className="absolute top-1/2 z-[15] inline-flex size-5 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow hover:text-foreground"
                        style={{ left: viewport.left + Math.max(0, viewport.width - LABEL_W) - 24 }}
                      >
                        <ArrowRightCircle className="size-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Drag tooltip — floats with the cursor while resizing or moving a
          bar so the user can commit to a date range instead of eyeballing. */}
      {dragHint && (
        <div
          className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-full rounded-md bg-foreground px-2 py-1 text-[11px] font-medium text-background shadow-lg"
          style={{ left: dragHint.x, top: dragHint.y - 12 }}
          role="status"
          aria-live="polite"
        >
          {dragHint.text}
        </div>
      )}
    </div>
  );
}
