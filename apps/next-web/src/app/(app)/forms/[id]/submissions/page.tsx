import type { CSSProperties } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getForm, listSubmissions } from '@/server/actions/forms';

const cell: CSSProperties = {
  border: '1px solid var(--border)',
  padding: '6px 10px',
  textAlign: 'left',
  fontSize: 13,
  verticalAlign: 'top',
};

function formatAnswer(v: unknown): string {
  if (v == null || v === '') return '—';
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'boolean') return v ? '✓' : '—';
  return String(v);
}

export default async function FormSubmissionsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTranslations('Forms');
  const form = await getForm(id);
  if (!form) notFound();

  const submissions = await listSubmissions(id);
  const fields = form.config.fields;

  return (
    <main style={{ padding: 24 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h1>
          {form.name} — {t('submissionsTitle')}
        </h1>
        <span>
          <Link href={`/forms/${form.id}`}>{t('editForm')}</Link>
          {' · '}
          <Link href="/forms">{t('backToForms')}</Link>
        </span>
      </header>

      {submissions.length === 0 ? (
        <p>{t('noSubmissions')}</p>
      ) : (
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>
              <th style={cell}>{t('submittedAt')}</th>
              {fields.map((f) => (
                <th key={f.key} style={cell}>
                  {f.label}
                </th>
              ))}
              <th style={cell}>{t('createdTask')}</th>
            </tr>
          </thead>
          <tbody>
            {submissions.map((s) => (
              <tr key={s.id}>
                <td style={cell}>{new Date(s.submittedAt).toLocaleString()}</td>
                {fields.map((f) => (
                  <td key={f.key} style={cell}>
                    {formatAnswer(s.answers[f.key])}
                  </td>
                ))}
                <td style={cell}>
                  {s.createdTaskId ? (
                    <Link href={`/tasks/${s.createdTaskId}`}>{t('viewTask')}</Link>
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
