'use client';

import { useEffect, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { loadAppToggles, setAppToggle } from '@/server/actions/apps';
import { notifyActionError } from '@/lib/apiErrorToast';
import styles from './AppCenter.module.css';
import type { AppRegistryEntry, ResolvedApp, AppScopeType, AppKey } from '@projectflow/types';

/**
 * The per-scope feature-toggle grid (Phase 10a). Renders every registry app with
 * its label/description, resolved on/off state, an inheritance hint, and a switch.
 * Only apps whose `overridableScopes` include the current scopeType get a live
 * switch; the rest are read-only. Refetches after its own toggle so the grid is
 * immediately consistent.
 */
export function AppCenter({ workspaceId, scopeType, scopeId }: { workspaceId: string; scopeType: AppScopeType; scopeId: string | null }) {
  const t = useTranslations('AppCenter');
  const [registry, setRegistry] = useState<AppRegistryEntry[]>([]);
  const [apps, setApps] = useState<ResolvedApp[]>([]);
  const [pending, start] = useTransition();

  const refetch = () => loadAppToggles(workspaceId, scopeType, scopeId).then((r) => {
    if (r.ok) { setRegistry(r.data.registry); setApps(r.data.apps); }
  });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void refetch(); }, [workspaceId, scopeType, scopeId]);

  const stateOf = (key: AppKey) => apps.find((a) => a.key === key);

  const onToggle = (key: AppKey, next: boolean) => start(async () => {
    // The workspace scope uses the workspaceId as its REST path identity.
    const id = scopeType === 'workspace' ? workspaceId : (scopeId ?? '');
    const r = await setAppToggle(scopeType, id, key, next);
    if (!r.ok) { notifyActionError(r); return; }
    await refetch();
  });

  return (
    <div className={styles.grid} role="list" aria-label={t('title')}>
      {registry.map((entry) => {
        const st = stateOf(entry.key);
        const enabled = st?.enabled ?? entry.defaultEnabled;
        const inherited = !st?.overridden || (st?.source != null && st.source !== scopeType);
        const overridable = entry.overridableScopes.includes(scopeType);
        return (
          <div key={entry.key} role="listitem" className={styles.row} data-app={entry.key} data-enabled={enabled}>
            <div className={styles.meta}>
              <span className={styles.label}>{t(`apps.${entry.label}.label`)}</span>
              <span className={styles.desc}>{t(`apps.${entry.label}.desc`)}</span>
              {inherited && <span className={styles.inherited}>{t('inheritedFrom', { scope: st?.source ?? 'default' })}</span>}
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={enabled}
              disabled={!overridable || pending}
              className={`${styles.switch} ${enabled ? styles.on : styles.off}`}
              onClick={() => onToggle(entry.key, !enabled)}
              aria-label={t('toggle', { app: t(`apps.${entry.label}.label`) })}
            >
              <span className={styles.knob} aria-hidden />
            </button>
          </div>
        );
      })}
    </div>
  );
}
