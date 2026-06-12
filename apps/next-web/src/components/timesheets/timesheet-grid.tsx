'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import {
  useReactTable, getCoreRowModel, flexRender, createColumnHelper,
} from '@tanstack/react-table';
import type { Timesheet, TimesheetAggregate, TimesheetAggregateRow } from '@projectflow/types';

/** Seconds → "Xh Ym". */
function fmt(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

interface Props {
  timesheet: Timesheet;
  aggregate: TimesheetAggregate;
  onSubmit: () => void;
}

const col = createColumnHelper<TimesheetAggregateRow>();

export function TimesheetGrid({ timesheet, aggregate, onSubmit }: Props) {
  const t = useTranslations('Timesheets');

  const columns = useMemo(() => [
    col.accessor('workDate',  { header: () => t('colDate') }),
    col.accessor('taskTitle', { header: () => t('colTask') }),
    col.accessor('totalSeconds',       { header: () => t('colTotal'),       cell: (c) => fmt(c.getValue()) }),
    col.accessor('billableSeconds',    { header: () => t('colBillable'),    cell: (c) => fmt(c.getValue()) }),
    col.accessor('nonBillableSeconds', { header: () => t('colNonBillable'), cell: (c) => fmt(c.getValue()) }),
  ], [t]);

  const table = useReactTable({ data: aggregate.rows, columns, getCoreRowModel: getCoreRowModel() });

  return (
    <div data-testid="timesheet-grid" className="flex h-full flex-col gap-3">
      <table className="w-full border-collapse text-xs">
        <thead className="bg-muted/40">
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id} className="border-b border-border text-left text-muted-foreground">
              {hg.headers.map((h) => (
                <th key={h.id} className="px-3 py-2 font-medium">
                  {flexRender(h.column.columnDef.header, h.getContext())}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.length === 0 ? (
            <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">{t('noEntries')}</td></tr>
          ) : (
            table.getRowModel().rows.map((row) => (
              <tr key={row.id} data-testid="timesheet-row" className="border-b border-border/60">
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="px-3 py-2">{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
                ))}
              </tr>
            ))
          )}
        </tbody>
        <tfoot>
          <tr className="border-t border-border font-semibold">
            <td className="px-3 py-2" colSpan={2}>{t('total')}</td>
            <td className="px-3 py-2" data-testid="timesheet-total">{fmt(aggregate.totals.totalSeconds)}</td>
            <td className="px-3 py-2" data-testid="timesheet-billable">{fmt(aggregate.totals.billableSeconds)}</td>
            <td className="px-3 py-2" data-testid="timesheet-nonbillable">{fmt(aggregate.totals.nonBillableSeconds)}</td>
          </tr>
        </tfoot>
      </table>

      <div className="flex items-center gap-2">
        <span data-testid="timesheet-status" className="rounded bg-muted px-2 py-0.5 text-[11px] uppercase tracking-wide">
          {t(`status.${timesheet.status}`)}
        </span>
        <button
          type="button"
          data-testid="timesheet-submit"
          disabled={timesheet.status === 'submitted' || timesheet.status === 'approved'}
          onClick={onSubmit}
          className="rounded bg-primary px-3 py-1 text-xs text-primary-foreground disabled:opacity-50"
        >
          {t('submit')}
        </button>
      </div>
    </div>
  );
}
