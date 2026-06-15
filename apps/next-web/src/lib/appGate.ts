import type { ResolvedApp, AppKey } from '@projectflow/types';

/** True when `key` is enabled in a resolved app set (default-closed if the set is absent). */
export function isAppOn(apps: ResolvedApp[] | undefined | null, key: AppKey): boolean {
  if (!apps) return false;                       // unknown set -> fail-closed (hide)
  return apps.find((a) => a.key === key)?.enabled ?? false;
}
