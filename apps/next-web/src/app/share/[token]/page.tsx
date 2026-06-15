import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { fetchPublicShare } from '@/server/public/share';
import { PublicObjectRenderer } from './PublicObjectRenderer';

// PUBLIC, sessionless route — OUTSIDE the (app) group. Resolves the share token
// via a cookieless fetch (see fetchPublicShare) and renders a read-only,
// navigation-stripped projection of exactly one object. 404s on
// missing/expired/revoked tokens. `params` is a Promise in this Next version.
export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const projection = await fetchPublicShare(token);
  if (!projection) notFound();
  return <PublicObjectRenderer projection={projection} />;
}

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const projection = await fetchPublicShare(token);
  const t = await getTranslations('Share');
  return { title: projection?.title ?? t('title') };
}
