// Fixed locale so the Node server (defaults to en-US) and the browser (e.g.
// id-ID) format dates identically — Intl.DateTimeFormat(undefined) diverges
// between them and triggers a React hydration mismatch on any SSR'd date.
// Swept app-wide in Phase 3.1. 'en-US' matches the app's existing
// server-rendered output, so the visible format is unchanged.
const LOCALE = 'en-US';

// Module-private: consumers use the format* functions below, not the raw Intl
// instances — keeps the public surface to functions and avoids name collisions
// at call sites.
const shortDate = new Intl.DateTimeFormat(LOCALE, { month: 'short', day: 'numeric' });
const shortDateYear = new Intl.DateTimeFormat(LOCALE, { month: 'short', day: 'numeric', year: 'numeric' });
const shortTime = new Intl.DateTimeFormat(LOCALE, { hour: 'numeric', minute: '2-digit' });
const shortDateTime = new Intl.DateTimeFormat(LOCALE, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const dateTime = new Intl.DateTimeFormat(LOCALE, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });

const toDate = (d: Date | string): Date => (typeof d === 'string' ? new Date(d) : d);

/** "Mar 15" — month + day. */
export function formatShortDate(d: Date | string): string { return shortDate.format(toDate(d)); }
/** "Mar 15, 2026" — month + day + year. */
export function formatShortDateYear(d: Date | string): string { return shortDateYear.format(toDate(d)); }
/** "2:30 PM" — time only. */
export function formatShortTime(d: Date | string): string { return shortTime.format(toDate(d)); }
/** "Mar 15, 02:30 PM" — month + day + time, no year. */
export function formatShortDateTime(d: Date | string): string { return shortDateTime.format(toDate(d)); }
/** "Mar 15, 2026, 02:30 PM" — full date + time. */
export function formatDateTime(d: Date | string): string { return dateTime.format(toDate(d)); }
