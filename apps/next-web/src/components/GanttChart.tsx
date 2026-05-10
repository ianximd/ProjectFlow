'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import styles from './GanttChart.module.css';

// ─── Types ──────────────────────────────────────────────────────────────────

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

type ZoomLevel = 'month' | 'quarter' | 'year';

const ZOOM_CFG = {
  month:   { label: 'Monthly',     unitDays: 1,  colPx: 28, daysBefore: 15, daysAfter: 45  },
  quarter: { label: 'Quarterly',   unitDays: 7,  colPx: 70, daysBefore: 30, daysAfter: 90  },
  year:    { label: 'Yearly',      unitDays: 30, colPx: 80, daysBefore: 60, daysAfter: 305 },
} as const;

const ROW_HEIGHT = 40;
const LABEL_W    = 260;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function today0(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

function parseDate(s: string | null): Date | null {
  if (!s) return null;
  const d = new Date(s);
  d.setHours(0, 0, 0, 0);
  return isNaN(d.getTime()) ? null : d;
}

function toIsoDate(d: Date): string {
  return d.toISOString().split('T')[0];
}

function isWeekend(d: Date): boolean {
  return d.getDay() === 0 || d.getDay() === 6;
}

// Generate slot start dates for the given zoom over the full range
function buildSlots(zoom: ZoomLevel, rangeStart: Date, rangeEnd: Date): Date[] {
  const slots: Date[] = [];
  const { unitDays } = ZOOM_CFG[zoom];

  if (zoom === 'month') {
    const cur = new Date(rangeStart);
    while (cur <= rangeEnd) { slots.push(new Date(cur)); cur.setDate(cur.getDate() + 1); }
  } else if (zoom === 'quarter') {
    // Start from the Monday of the week containing rangeStart
    const cur = new Date(rangeStart);
    const dow = cur.getDay();
    cur.setDate(cur.getDate() - (dow === 0 ? 6 : dow - 1));
    while (cur <= rangeEnd) { slots.push(new Date(cur)); cur.setDate(cur.getDate() + 7); }
  } else {
    // Monthly: start of each calendar month
    const cur = new Date(rangeStart);
    cur.setDate(1);
    while (cur <= rangeEnd) { slots.push(new Date(cur)); cur.setMonth(cur.getMonth() + 1); }
  }
  return slots;
}

function formatSlot(d: Date, zoom: ZoomLevel): string {
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  if (zoom === 'month')   return d.getDate() === 1 ? `${MONTHS[d.getMonth()]} 1` : String(d.getDate());
  if (zoom === 'quarter') return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  return `${MONTHS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`;
}

const TYPE_ICONS: Record<string, string> = {
  EPIC: '⬡', STORY: '◆', TASK: '☑', BUG: '🐛', SUBTASK: '↳',
  FEATURE: '★', IMPROVEMENT: '▲', TEST: '⚗',
};
const TYPE_CLASSES: Record<string, string> = {
  EPIC: styles.typeEPIC, STORY: styles.typeSTORY, TASK: styles.typeTASK,
  BUG:  styles.typeBUG,  SUBTASK: styles.typeSUBTASK, FEATURE: styles.typeFEATURE,
  IMPROVEMENT: styles.typeIMPROVEMENT, TEST: styles.typeTEST,
};

// ─── Drag state ───────────────────────────────────────────────────────────────

interface DragState {
  taskId: string;
  handle: 'left' | 'right' | 'move';
  startX: number;
  origStart: Date | null;
  origEnd: Date | null;
  pxPerDay: number;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function GanttChart({ items, deps = [], onUpdateDates }: Props) {
  const [zoom, setZoom]       = useState<ZoomLevel>('quarter');
  const scrollRef             = useRef<HTMLDivElement>(null);
  const [overrides, setOverrides] = useState<Record<string, { startDate?: string; dueDate?: string }>>({});
  const dragRef               = useRef<DragState | null>(null);

  const cfg       = ZOOM_CFG[zoom];
  const today     = today0();
  const rangeStart = addDays(today, -cfg.daysBefore);
  const rangeEnd   = addDays(today, cfg.daysAfter);
  const slots      = buildSlots(zoom, rangeStart, rangeEnd);
  const pxPerDay   = cfg.colPx / cfg.unitDays;
  const totalW     = slots.length * cfg.colPx;
  const todayPx    = daysBetween(rangeStart, today) * pxPerDay;

  // ─── Scroll today into view on mount / zoom change ──────────────────────
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollLeft = Math.max(0, todayPx - el.clientWidth / 2);
  }, [zoom]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Global mouse events for drag ───────────────────────────────────────
  useEffect(() => {
    function onMove(e: MouseEvent) {
      const ds = dragRef.current;
      if (!ds) return;
      const deltaX    = e.clientX - ds.startX;
      const deltaDays = Math.round(deltaX / ds.pxPerDay);

      let newStart = ds.origStart ? addDays(ds.origStart, ds.handle === 'right' ? 0 : deltaDays) : null;
      let newEnd   = ds.origEnd   ? addDays(ds.origEnd,   ds.handle === 'left'  ? 0 : deltaDays) : null;

      // For 'move', shift both
      if (ds.handle === 'move') {
        newStart = ds.origStart ? addDays(ds.origStart, deltaDays) : null;
        newEnd   = ds.origEnd   ? addDays(ds.origEnd,   deltaDays) : null;
      }

      // Clamp so start <= end
      if (newStart && newEnd && newStart > newEnd) {
        if (ds.handle === 'left')  newStart = new Date(newEnd);
        else                       newEnd   = new Date(newStart);
      }

      setOverrides(prev => ({
        ...prev,
        [ds.taskId]: {
          startDate: newStart ? toIsoDate(newStart) : undefined,
          dueDate:   newEnd   ? toIsoDate(newEnd)   : undefined,
        },
      }));
    }

    function onUp(e: MouseEvent) {
      const ds = dragRef.current;
      if (!ds) return;
      dragRef.current = null;
      const ov = overrides[ds.taskId];
      if (ov && onUpdateDates) {
        onUpdateDates(ds.taskId, ov.startDate ?? null, ov.dueDate ?? null);
      }
    }

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [overrides, onUpdateDates]);

  // ─── Derived row list ────────────────────────────────────────────────────
  const rows = items.map(item => ({
    item,
    depth: item.epicId ? 1 : 0,
    isEpic: item.type === 'EPIC',
  }));

  // ─── Bar position ────────────────────────────────────────────────────────
  function barStyle(item: GanttItem): React.CSSProperties | null {
    const ov = overrides[item.id];
    const sd = parseDate(ov?.startDate ?? item.startDate);
    const ed = parseDate(ov?.dueDate   ?? item.dueDate);

    const s = sd ?? ed;
    const e = ed ?? sd;
    if (!s || !e) return null;

    const left  = daysBetween(rangeStart, s) * pxPerDay;
    const width = Math.max(20, daysBetween(s, e) * pxPerDay);
    return { left, width };
  }

  function startDrag(
    e: React.MouseEvent,
    item: GanttItem,
    handle: 'left' | 'right' | 'move',
  ) {
    e.stopPropagation();
    e.preventDefault();
    const ov = overrides[item.id];
    dragRef.current = {
      taskId:    item.id,
      handle,
      startX:    e.clientX,
      origStart: parseDate(ov?.startDate ?? item.startDate),
      origEnd:   parseDate(ov?.dueDate   ?? item.dueDate),
      pxPerDay,
    };
  }

  return (
    <div className={styles.wrapper}>
      {/* ── Controls ── */}
      <div className={styles.controls}>
        <div className={styles.zoomBtns}>
          {(['month', 'quarter', 'year'] as ZoomLevel[]).map(z => (
            <button
              key={z}
              className={zoom === z ? styles.zoomActive : styles.zoomBtn}
              onClick={() => setZoom(z)}
            >
              {ZOOM_CFG[z].label}
            </button>
          ))}
        </div>
        <button className={styles.todayBtn} onClick={() => {
          const el = scrollRef.current;
          if (el) el.scrollLeft = Math.max(0, todayPx - el.clientWidth / 2);
        }}>
          Today
        </button>
        <div className={styles.controlsSpacer} />
        <div className={styles.legend}>
          {[['EPIC','#7c3aed'],['STORY','#16a34a'],['TASK','#2563eb'],['BUG','#dc2626']].map(([t,c]) => (
            <span key={t} className={styles.legendItem}>
              <span className={styles.legendDot} style={{ background: c }} />
              {t}
            </span>
          ))}
        </div>
      </div>

      {/* ── Scrollable chart ── */}
      <div className={styles.chart} ref={scrollRef}>
        {/* header row */}
        <div className={styles.headerRow}>
          <div className={styles.labelHeader}>Issue</div>
          <div style={{ position: 'relative', width: totalW, flexShrink: 0 }}>
            <div className={styles.slotHeaders}>
              {slots.map((slot, i) => {
                const isToday = daysBetween(today, slot) === 0;
                return (
                  <div
                    key={i}
                    className={`${styles.slotHeader}${isToday ? ` ${styles.slotHeaderToday}` : ''}`}
                    style={{ width: cfg.colPx, flexShrink: 0 }}
                  >
                    {formatSlot(slot, zoom)}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* empty state */}
        {rows.length === 0 && (
          <div className={styles.empty}>
            No epics or tasks with dates in this range.<br />
            Set a start date or due date on tasks to see them here.
          </div>
        )}

        {/* data rows */}
        {rows.map(({ item, depth, isEpic }) => {
          const bs = barStyle(item);
          const progressPct = isEpic && item.childCount > 0
            ? Math.round((item.childDoneCount / item.childCount) * 100)
            : null;

          return (
            <div key={item.id} className={styles.row}>
              {/* label */}
              <div
                className={styles.labelCell}
                style={{ paddingLeft: depth * 16 + 8 }}
              >
                <span className={styles.typeIcon}>
                  {TYPE_ICONS[item.type] ?? '○'}
                </span>
                <span className={styles.issueKey}>{item.issueKey}</span>
                <span className={`${styles.itemTitle}${isEpic ? ` ${styles.epicTitle}` : ''}`}>
                  {item.title}
                </span>
              </div>

              {/* timeline cell */}
              <div
                className={styles.timelineCell}
                style={{ width: totalW, flexShrink: 0, position: 'relative', minHeight: ROW_HEIGHT }}
              >
                {/* column background lines */}
                {slots.map((slot, i) => {
                  const isWknd   = zoom === 'month' && isWeekend(slot);
                  const isTodayCol = daysBetween(today, slot) === 0;
                  return (
                    <div
                      key={i}
                      className={`${styles.colBg}${isWknd ? ` ${styles.colBgWeekend}` : ''}${isTodayCol ? ` ${styles.colBgToday}` : ''}`}
                      style={{ left: i * cfg.colPx, width: cfg.colPx }}
                    />
                  );
                })}

                {/* today line */}
                <div className={styles.todayLine} style={{ left: todayPx }} />

                {/* bar */}
                {bs && (
                  <div
                    className={`${styles.bar}${isEpic ? ` ${styles.epicBar}` : ''} ${TYPE_CLASSES[item.type] ?? ''}`}
                    style={bs}
                    onMouseDown={(e) => startDrag(e, item, 'move')}
                    title={`${item.issueKey} · ${item.title}`}
                  >
                    {progressPct !== null && (
                      <div
                        className={styles.barProgress}
                        style={{ width: `${progressPct}%` }}
                      />
                    )}
                    {/* resize handles */}
                    <div
                      className={`${styles.resizeHandle} ${styles.left}`}
                      onMouseDown={(e) => startDrag(e, item, 'left')}
                    />
                    <span className={styles.barLabel}>{item.title}</span>
                    <div
                      className={`${styles.resizeHandle} ${styles.right}`}
                      onMouseDown={(e) => startDrag(e, item, 'right')}
                    />
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
