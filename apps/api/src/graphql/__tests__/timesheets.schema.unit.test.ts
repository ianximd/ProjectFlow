import { describe, it, expect } from 'vitest';
import { schema } from '../schema.js';

describe('timesheets GraphQL mirror', () => {
  it('registers the timesheet query + submit/review mutations and a Timesheet type', () => {
    const q = schema.getQueryType()!.getFields();
    const m = schema.getMutationType()!.getFields();
    expect(q.timesheet).toBeDefined();
    expect(m.submitTimesheet).toBeDefined();
    expect(m.reviewTimesheet).toBeDefined();
    expect(schema.getType('Timesheet')).toBeDefined();
    expect(schema.getType('TimesheetAggregate')).toBeDefined();
  });
});
