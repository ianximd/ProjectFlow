'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { askAi, type AskResult, type AskCitation } from '@/server/actions/ai';

/** Link target for a cited object. Docs open the doc; everything else (task,
 *  comment) resolves to the task surface. */
function citationHref(c: AskCitation): string {
  return c.objectType === 'doc' ? `/docs/${c.objectId}` : `/tasks/${c.objectId}`;
}

/**
 * Ask AI panel (Phase 11b). Stateless single-shot Q&A: type a question, get an
 * answer grounded in the workspace's accessible content plus clickable citations.
 * The server action enforces the ai.use gate and permission-scoped citations.
 */
export function AskAiPanel({ workspaceId }: { workspaceId: string }) {
  const t = useTranslations('Ai');
  const [question, setQuestion] = useState('');
  const [result, setResult] = useState<AskResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const q = question.trim();
    if (!q || loading) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      setResult(await askAi(workspaceId, q));
    } catch {
      setError(t('noAnswer'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={onSubmit} className="flex gap-2">
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={t('placeholder')}
          aria-label={t('ask')}
          className="flex-1 rounded-md border px-3 py-2 text-sm outline-none"
        />
        <button
          type="submit"
          disabled={loading}
          className="rounded-md border px-3 py-2 text-sm font-medium disabled:opacity-60"
        >
          {loading ? t('thinking') : t('ask')}
        </button>
      </form>

      {error && (
        <p role="alert" className="text-sm text-muted-foreground">
          {error}
        </p>
      )}

      {result && (
        <div className="flex flex-col gap-3">
          <p className="whitespace-pre-wrap text-sm">{result.answer}</p>
          {result.citations.length > 0 && (
            <div>
              <h3 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
                {t('sources')}
              </h3>
              <ul className="flex flex-col gap-1">
                {result.citations.map((c) => (
                  <li key={`${c.objectType}:${c.objectId}`}>
                    <Link href={citationHref(c)} className="text-sm text-primary underline">
                      {c.objectType} · {c.objectId}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
