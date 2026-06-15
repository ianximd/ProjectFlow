import type { ShareProjection } from '@projectflow/types';
import { getTranslations } from 'next-intl/server';

// Read-only public renderer. NO app chrome, NO sibling/parent navigation, NO
// write affordances. Task + view render real content; doc/dashboard/whiteboard
// projections are not built yet (the resolver 404s those today) but the branch
// degrades gracefully if one is ever served.
export async function PublicObjectRenderer({ projection }: { projection: ShareProjection }) {
  const t = await getTranslations('Share');

  return (
    <article aria-label={projection.title}>
      <header style={{ marginBottom: 16 }}>
        <span style={{ fontSize: 12, textTransform: 'uppercase', color: '#6b7280' }}>{t('publicBadge')}</span>
        <h1 style={{ fontSize: 24, fontWeight: 600, margin: '4px 0' }}>{projection.title}</h1>
        <p style={{ fontSize: 12, color: '#6b7280', margin: 0 }}>{t('readOnlyBadge')}</p>
      </header>

      {projection.objectType === 'task' && (
        <TaskView
          data={projection.data}
          labels={{ status: t('fieldStatus'), priority: t('fieldPriority'), due: t('fieldDue') }}
        />
      )}
      {projection.objectType === 'view' && <ViewView title={projection.title} data={projection.data} />}
      {['doc', 'dashboard', 'whiteboard'].includes(projection.objectType) && (
        <p>{t('typeUnavailable')}</p>
      )}
    </article>
  );
}

function TaskView({
  data, labels,
}: { data: Record<string, unknown>; labels: { status: string; priority: string; due: string } }) {
  return (
    <section>
      {data.status != null && <p><strong>{labels.status}:</strong> {String(data.status)}</p>}
      {data.priority != null && <p><strong>{labels.priority}:</strong> {String(data.priority)}</p>}
      {data.dueDate != null && <p><strong>{labels.due}:</strong> {String(data.dueDate)}</p>}
      {data.description != null && (
        <div style={{ marginTop: 12, whiteSpace: 'pre-wrap' }}>{String(data.description)}</div>
      )}
    </section>
  );
}

function ViewView({ title, data }: { title: string; data: Record<string, unknown> }) {
  return (
    <section>
      <p><strong>{title}</strong> ({String((data as { type?: unknown }).type ?? 'view')})</p>
      <pre style={{ background: '#f3f4f6', padding: 12, borderRadius: 8, overflow: 'auto' }}>
        {JSON.stringify((data as { config?: unknown }).config ?? {}, null, 2)}
      </pre>
    </section>
  );
}
