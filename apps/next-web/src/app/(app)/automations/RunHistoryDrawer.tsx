'use client';

import { useEffect, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { loadAutomationRuns } from '@/server/actions/automations';
import { notifyActionError } from '@/lib/apiErrorToast';
import { formatShortDate } from '@/lib/date';
import type { AutomationRun, AutomationRunStatus } from '@projectflow/types';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import styles from './automations.module.css';
import { runStatusKey, formatDurationMs } from './runFormat';
import { TRIGGER_KEYS } from './automations-view';

// Re-export pure helpers so they can be imported from the drawer module directly
// (unit test imports them from this file for convenience).
export { runStatusKey, formatDurationMs };

const PAGE = 20;

export function RunHistoryDrawer({ ruleId, ruleName, open, onClose }: {
  ruleId:   string;
  ruleName: string;
  open:     boolean;
  onClose:  () => void;
}) {
  const t = useTranslations('Automations');
  const [runs,    setRuns]    = useState<AutomationRun[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loaded,  setLoaded]  = useState(false);
  const [pending, start]      = useTransition();

  // Reset + initial fetch whenever the drawer opens (or the ruleId changes)
  useEffect(() => {
    if (!open) { setRuns([]); setHasMore(false); setLoaded(false); return; }
    start(async () => {
      const r = await loadAutomationRuns(ruleId, 0);
      if (!r.ok) { notifyActionError(r); return; }
      const page = r.runs ?? [];
      setRuns(page);
      setHasMore(page.length === PAGE);
      setLoaded(true);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ruleId]);

  const loadMore = () => start(async () => {
    const r = await loadAutomationRuns(ruleId, runs.length);
    if (!r.ok) { notifyActionError(r); return; }
    const page = r.runs ?? [];
    setRuns((prev) => [...prev, ...page]);
    setHasMore(page.length === PAGE);
  });

  const statusVariant = (status: AutomationRunStatus) => {
    switch (status) {
      case 'success':      return 'success'  as const;
      case 'failed':       return 'destructive' as const;
      case 'loop_blocked': return 'destructive' as const;
      case 'partial':      return 'warning'  as const;
      case 'skipped':
      default:             return 'secondary' as const;
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('historyTitle', { name: ruleName })}</DialogTitle>
        </DialogHeader>
        <DialogBody className="max-h-[60vh] overflow-y-auto">
          {loaded && runs.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">{t('historyEmpty')}</p>
          ) : (
            <ul className={styles.runList}>
              {runs.map((r) => (
                <li key={r.id} className={styles.runRow} data-run-status={r.status}>
                  <Badge variant={statusVariant(r.status)} size="sm">
                    {t(runStatusKey(r.status) as Parameters<typeof t>[0])}
                  </Badge>
                  <span className={styles.runTrigger} title={t('runTrigger')}>
                    {TRIGGER_KEYS[r.triggerType as keyof typeof TRIGGER_KEYS]
                      ? t(TRIGGER_KEYS[r.triggerType as keyof typeof TRIGGER_KEYS] as Parameters<typeof t>[0])
                      : r.triggerType}
                  </span>
                  <span className={styles.runMeta}>
                    {t('runStartedAt', { date: formatShortDate(new Date(r.startedAt)) })}
                  </span>
                  <span className={styles.runMeta}>
                    {t('runDuration', { ms: formatDurationMs(r.durationMs) })}
                  </span>
                  {r.error && (
                    <span className={styles.runError}>{r.error}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {hasMore && (
            <Button
              size="sm"
              variant="ghost"
              onClick={loadMore}
              disabled={pending}
              className="mt-2"
            >
              {t('historyLoadMore')}
            </Button>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
