import { describe, it, expect } from 'vitest';
import { computeRecipients } from '../fanout.js';

const R = 'aaaaaaaa-0000-0000-0000-000000000001'; // reporter
const X = 'aaaaaaaa-0000-0000-0000-000000000002'; // assignee
const W = 'aaaaaaaa-0000-0000-0000-000000000003'; // watcher
const ACTOR = 'aaaaaaaa-0000-0000-0000-000000000009';

describe('computeRecipients', () => {
  it('unions reporter + assignees + watchers', () => {
    const r = computeRecipients({ reporterId: R, assigneeIds: [X], watcherIds: [W], actorId: ACTOR });
    expect(r.sort()).toEqual([R, X, W].map((s) => s.toUpperCase()).sort());
  });

  it('dedupes a user appearing in multiple roles (case-insensitive)', () => {
    const r = computeRecipients({
      reporterId: R, assigneeIds: [R.toUpperCase()], watcherIds: [R.toLowerCase()], actorId: ACTOR,
    });
    expect(r).toEqual([R.toUpperCase()]);
  });

  it('excludes the actor', () => {
    const r = computeRecipients({ reporterId: ACTOR, assigneeIds: [X], watcherIds: [], actorId: ACTOR });
    expect(r).toEqual([X.toUpperCase()]);
  });

  it('excludes ids in extraExclude (e.g. already-notified mentions)', () => {
    const r = computeRecipients({ reporterId: R, assigneeIds: [X], watcherIds: [W], actorId: ACTOR, extraExclude: [X] });
    expect(r.sort()).toEqual([R, W].map((s) => s.toUpperCase()).sort());
  });

  it('handles empty/missing inputs', () => {
    expect(computeRecipients({ reporterId: null, assigneeIds: [], watcherIds: [], actorId: ACTOR })).toEqual([]);
  });
});
