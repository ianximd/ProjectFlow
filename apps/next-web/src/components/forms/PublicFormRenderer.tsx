'use client';

import { useMemo, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { evalVisibility, validateAnswers } from '@/lib/formBranching';
import { submitPublicFormAction } from '@/server/actions/public-forms';
import styles from './PublicFormRenderer.module.css';
import type { PublicFormView, FormField } from '@projectflow/types';

export function PublicFormRenderer({ slug, view }: { slug: string; view: PublicFormView }) {
  const t = useTranslations('Forms');
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const visibility = useMemo(() => evalVisibility(view.config, answers), [view.config, answers]);
  const visibleFields = view.config.fields.filter((f) => visibility[f.key]);

  const setAnswer = (key: string, value: unknown) => setAnswers((prev) => ({ ...prev, [key]: value }));

  const onSubmit = () => {
    const v = validateAnswers(view.config, answers);
    if (!v.ok) { setError(t('submitError')); return; }
    // Send only visible answers (hidden ones are stripped server-side too).
    const payload: Record<string, unknown> = {};
    for (const f of visibleFields) if (answers[f.key] != null) payload[f.key] = answers[f.key];
    start(async () => {
      const r = await submitPublicFormAction(slug, payload, view.readToken);
      if (!r.ok) { setError(r.error || t('submitError')); return; }
      setError(null); setDone(true);
    });
  };

  if (done) return <div className={styles.thanks}>{t('thanks')}</div>;

  return (
    <form className={styles.root} onSubmit={(e) => { e.preventDefault(); onSubmit(); }}>
      <h1 className={styles.title}>{view.name}</h1>
      {visibleFields.map((f) => (
        <div key={f.key} className={styles.field} data-field-key={f.key}>
          <label className={styles.label}>
            {f.label}{f.required && <span className={styles.req}> *</span>}
          </label>
          {renderInput(f, answers[f.key], (v) => setAnswer(f.key, v))}
        </div>
      ))}
      {error && <p className={styles.error}>{error}</p>}
      <button className={styles.submitBtn} type="submit" disabled={pending}>
        {pending ? t('submitting') : t('submit')}
      </button>
    </form>
  );
}

function renderInput(field: FormField, value: unknown, onChange: (v: unknown) => void) {
  switch (field.type) {
    case 'long_text':
      return <textarea value={(value as string) ?? ''} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value)} />;
    case 'number':
      return <input type="number" value={(value as number) ?? ''} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))} />;
    case 'email':
      return <input type="email" value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />;
    case 'date':
      return <input type="date" value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />;
    case 'checkbox':
      return <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />;
    case 'select':
      return (
        <select value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)}>
          <option value="">—</option>
          {(field.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      );
    case 'multiselect':
      return (
        <select
          multiple
          value={(value as string[]) ?? []}
          onChange={(e) => onChange(Array.from(e.target.selectedOptions).map((o) => o.value))}
        >
          {(field.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      );
    default: // short_text
      return <input type="text" value={(value as string) ?? ''} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value)} />;
  }
}
