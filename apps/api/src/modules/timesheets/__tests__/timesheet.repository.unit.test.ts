import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.mock is hoisted to the top of the file, so the mock fns must be created
// via vi.hoisted() (not plain top-level const) to be initialised in time.
const { execSpOne, execSp } = vi.hoisted(() => ({ execSpOne: vi.fn(), execSp: vi.fn() }));
vi.mock('../../../shared/lib/sqlClient.js', () => ({ execSpOne, execSp }));

import { TimesheetRepository } from '../timesheet.repository.js';

beforeEach(() => { execSpOne.mockReset(); execSp.mockReset(); });

describe('TimesheetRepository.aggregate', () => {
  it('maps the two SP result sets to { rows, totals }', async () => {
    execSp.mockResolvedValue([
      [{ WorkDate: new Date('2026-06-02'), TaskId: 'k1', TaskTitle: 'A',
         TotalSeconds: 3600, BillableSeconds: 3600, NonBillableSeconds: 0 }],
      [{ TotalSeconds: 3600, BillableSeconds: 3600, NonBillableSeconds: 0 }],
    ]);
    const repo = new TimesheetRepository();
    const agg = await repo.aggregate('t1');
    expect(agg.rows).toHaveLength(1);
    expect(agg.rows[0].taskTitle).toBe('A');
    expect(agg.totals.billableSeconds).toBe(3600);
  });
});
