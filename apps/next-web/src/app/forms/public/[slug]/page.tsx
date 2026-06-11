import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { fetchPublicForm } from '@/server/public/forms';
import { PublicFormRenderer } from '@/components/forms/PublicFormRenderer';

// PUBLIC, sessionless route — OUTSIDE the (app) group so it renders without a
// session. Lives at /forms/public/[slug] (mirrors the API's /forms/public/:slug)
// rather than /forms/[slug], which would collide with the authed builder route
// /forms/[id] (Next.js forbids two dynamic slug names at the same path level).
export default async function PublicFormPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const view = await fetchPublicForm(slug);
  if (!view) notFound();
  return <PublicFormRenderer slug={slug} view={view} />;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const view = await fetchPublicForm(slug);
  const t = await getTranslations('Forms');
  return { title: view?.name ?? t('notFound') };
}
