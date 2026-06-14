'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import type { RecurrenceFreq, DeliveryChannel } from '@projectflow/types';
import { createSchedule } from '@/server/actions/scheduled-reports';
import { notifyActionError } from '@/lib/apiErrorToast';
import styles from './ScheduleReportDialog.module.css';

interface ScheduleReportDialogProps {
  workspaceId: string;
  dashboardId: string;
  recipientOptions: Array<{ id: string; name: string }>;
  onClose: () => void;
  onCreated?: () => void;
}

const FREQS: RecurrenceFreq[] = ['daily', 'weekly', 'monthly', 'yearly'];
// 0=Sun .. 6=Sat (matches RecurrenceRule.byWeekday + the API cadence schema).
const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

/**
 * Self-contained modal that composes a recurrence cadence (freq + interval +
 * optional weekday picker when weekly), a delivery channel (inbox today; email
 * disabled "coming soon"), and a recipient multi-select, then calls the
 * createSchedule server action. Errors surface via the shared toast helper.
 */
export function ScheduleReportDialog({
  workspaceId,
  dashboardId,
  recipientOptions,
  onClose,
  onCreated,
}: ScheduleReportDialogProps) {
  const t = useTranslations('ScheduledReport');
  const [freq, setFreq] = useState<RecurrenceFreq>('weekly');
  const [interval, setInterval] = useState(1);
  const [byWeekday, setByWeekday] = useState<number[]>([1]); // default Monday
  const [channel] = useState<DeliveryChannel>('inbox'); // email is "coming soon"
  const [recipients, setRecipients] = useState<string[]>([]);
  const [saving, startSave] = useTransition();

  function toggleWeekday(day: number): void {
    setByWeekday((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort((a, b) => a - b),
    );
  }

  function toggleRecipient(id: string): void {
    setRecipients((prev) => (prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id]));
  }

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    if (recipients.length === 0) {
      notifyActionError({ error: t('needRecipient') });
      return;
    }
    const cadence = {
      freq,
      interval: Math.max(1, interval),
      ...(freq === 'weekly' && byWeekday.length > 0 ? { byWeekday } : {}),
    };
    startSave(async () => {
      const r = await createSchedule({
        workspaceId,
        dashboardId,
        cadence,
        deliveryChannel: channel,
        recipients,
      });
      if (!r.ok) {
        notifyActionError(r);
        return;
      }
      onCreated?.();
      onClose();
    });
  }

  return (
    <div
      className={styles.backdrop}
      onClick={(e) => {
        if (e.target === e.currentTarget && !saving) onClose();
      }}
    >
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-label={t('title')}>
        <h2 className={styles.heading}>{t('title')}</h2>
        <form onSubmit={handleSubmit} className={styles.form}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="sr-freq">
              {t('frequency')}
            </label>
            <select
              id="sr-freq"
              className={styles.select}
              value={freq}
              disabled={saving}
              onChange={(e) => setFreq(e.target.value as RecurrenceFreq)}
            >
              {FREQS.map((f) => (
                <option key={f} value={f}>
                  {t(f)}
                </option>
              ))}
            </select>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="sr-interval">
              {t('everyN')}
            </label>
            <input
              id="sr-interval"
              className={styles.input}
              type="number"
              min={1}
              value={interval}
              disabled={saving}
              onChange={(e) => setInterval(Number(e.target.value) || 1)}
            />
          </div>

          {freq === 'weekly' && (
            <div className={styles.field}>
              <span className={styles.label}>{t('onDays')}</span>
              <div className={styles.weekdays}>
                {WEEKDAY_KEYS.map((key, day) => {
                  const active = byWeekday.includes(day);
                  return (
                    <button
                      key={key}
                      type="button"
                      disabled={saving}
                      aria-pressed={active}
                      className={`${styles.weekday} ${active ? styles.weekdayActive : ''}`}
                      onClick={() => toggleWeekday(day)}
                    >
                      {t(key)}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className={styles.field}>
            <span className={styles.label}>{t('channel')}</span>
            <div className={styles.channels}>
              <label className={styles.radio}>
                <input type="radio" name="sr-channel" checked readOnly disabled={saving} />
                {t('channelInbox')}
              </label>
              <label className={`${styles.radio} ${styles.radioDisabled}`}>
                <input type="radio" name="sr-channel" disabled />
                {t('channelEmailSoon')}
              </label>
            </div>
          </div>

          <div className={styles.field}>
            <span className={styles.label}>{t('recipients')}</span>
            <div className={styles.recipients}>
              {recipientOptions.map((opt) => (
                <label key={opt.id} className={styles.recipient}>
                  <input
                    type="checkbox"
                    checked={recipients.includes(opt.id)}
                    disabled={saving}
                    onChange={() => toggleRecipient(opt.id)}
                  />
                  {opt.name}
                </label>
              ))}
            </div>
          </div>

          <div className={styles.actions}>
            <button
              type="button"
              className={styles.cancel}
              onClick={onClose}
              disabled={saving}
            >
              {t('cancel')}
            </button>
            <button type="submit" className={styles.submit} disabled={saving}>
              {saving ? t('saving') : t('schedule')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default ScheduleReportDialog;
