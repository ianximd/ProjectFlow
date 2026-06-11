// Shared duration formatting/parsing for the time-tracking UI. Extracted verbatim
// from WorkLogSection so TaskEstimateBar reuses the exact same semantics.

/** Format seconds → "2h 30m" / "45m" / "30s" */
export function formatDuration(seconds: number): string {
  if (seconds <= 0) return '0m';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const parts: string[] = [];
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  if (!h && s) parts.push(`${s}s`);
  return parts.join(' ') || '0m';
}

/** Parse "1h 30m", "2h", "45m", "90m" → seconds (or null if nothing parsed) */
export function parseDuration(input: string): number | null {
  const str = input.trim().toLowerCase();
  let total = 0;
  const hMatch = str.match(/(\d+)\s*h/);
  const mMatch = str.match(/(\d+)\s*m/);
  const sMatch = str.match(/(\d+)\s*s/);
  if (hMatch) total += parseInt(hMatch[1], 10) * 3600;
  if (mMatch) total += parseInt(mMatch[1], 10) * 60;
  if (sMatch) total += parseInt(sMatch[1], 10);
  return total > 0 ? total : null;
}
