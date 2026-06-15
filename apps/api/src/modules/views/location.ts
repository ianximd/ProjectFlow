import type { LocationValue } from '@projectflow/types';

/** Decode a raw stored `location` value (JSON string or already-parsed object)
 *  into a validated LocationValue, or null when missing/invalid. Mirrors the
 *  Phase 2 validator's range checks so the Map view never plots a bad pin. */
export function parseLocationValue(raw: unknown): LocationValue | null {
  if (raw == null) return null;
  let v: unknown = raw;
  if (typeof raw === 'string') {
    try { v = JSON.parse(raw); } catch { return null; }
  }
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const lat = typeof o.lat === 'number' ? o.lat : Number(o.lat);
  const lng = typeof o.lng === 'number' ? o.lng : Number(o.lng);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) return null;
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) return null;
  const label = typeof o.label === 'string' ? o.label : '';
  return { lat, lng, label };
}
