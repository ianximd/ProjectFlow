// Fixed locale so the Node server (defaults to en-US) and the browser (e.g.
// id-ID) format dates identically — Intl.DateTimeFormat(undefined) diverges
// between them and triggers a React hydration mismatch on any SSR'd date
// (pre-existing on /projects + /roadmap). 'en-US' matches the app's existing
// server-rendered output, so the visible format is unchanged.
const LOCALE = 'en-US';

export const shortDate = new Intl.DateTimeFormat(LOCALE, { month: 'short', day: 'numeric' });
export const shortDateYear = new Intl.DateTimeFormat(LOCALE, { month: 'short', day: 'numeric', year: 'numeric' });

export function formatShortDate(d: Date | string): string {
  return shortDate.format(typeof d === 'string' ? new Date(d) : d);
}

export function formatShortDateYear(d: Date | string): string {
  return shortDateYear.format(typeof d === 'string' ? new Date(d) : d);
}
