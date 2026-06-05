import { describe, it, expect } from 'vitest';
import { matchesInboxTab } from '../inbox-tabs';

// A live `notificationAdded` delta carries only { type, isRead } that the tab
// filter can judge — it is freshly-arrived, so never saved-for-later.
const unread = (type: string) => ({ type, isRead: false });
const read = (type: string) => ({ type, isRead: true });

describe('matchesInboxTab', () => {
  it('all: accepts every notification regardless of type/read state', () => {
    expect(matchesInboxTab('all', unread('MENTION'))).toBe(true);
    expect(matchesInboxTab('all', read('TASK_ASSIGNED'))).toBe(true);
  });

  it('unread: only unread notifications', () => {
    expect(matchesInboxTab('unread', unread('MENTION'))).toBe(true);
    expect(matchesInboxTab('unread', read('MENTION'))).toBe(false);
  });

  it('assigned: comment/task assignments only', () => {
    expect(matchesInboxTab('assigned', unread('COMMENT_ASSIGNED'))).toBe(true);
    expect(matchesInboxTab('assigned', unread('TASK_ASSIGNED'))).toBe(true);
    expect(matchesInboxTab('assigned', unread('MENTION'))).toBe(false);
  });

  it('mentions: MENTION only', () => {
    expect(matchesInboxTab('mentions', unread('MENTION'))).toBe(true);
    expect(matchesInboxTab('mentions', unread('COMMENT_ADDED'))).toBe(false);
  });

  it('comments: added + assigned comment events', () => {
    expect(matchesInboxTab('comments', unread('COMMENT_ADDED'))).toBe(true);
    expect(matchesInboxTab('comments', unread('COMMENT_ASSIGNED'))).toBe(true);
    expect(matchesInboxTab('comments', unread('MENTION'))).toBe(false);
  });

  it('saved: never matches a live delta (it cannot be saved-for-later yet)', () => {
    expect(matchesInboxTab('saved', unread('MENTION'))).toBe(false);
    expect(matchesInboxTab('saved', read('TASK_ASSIGNED'))).toBe(false);
  });
});
