import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { listForms } from '@/server/actions/forms';

export default async function FormsPage() {
  const t = await getTranslations('Forms');
  const forms = await listForms();
  return (
    <main style={{ padding: 24 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h1>{t('title')}</h1>
        <Link href="/forms/new">{t('newForm')}</Link>
      </header>
      <ul>
        {forms.map((f) => (
          <li key={f.id}>
            <Link href={`/forms/${f.id}`}>{f.name}</Link>
            {f.isPublic && f.publicSlug && (
              <span> · <Link href={`/forms/public/${f.publicSlug}`} target="_blank">{t('openPublic')}</Link></span>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}
