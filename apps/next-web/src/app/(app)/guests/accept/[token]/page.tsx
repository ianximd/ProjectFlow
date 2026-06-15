import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { acceptGuestInvite } from '@/server/actions/guests';

export default async function AcceptGuestInvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const result = await acceptGuestInvite(token);

  if (result.ok) {
    const { objectType, objectId } = result.data;
    if (objectType === 'LIST') {
      redirect(`/lists/${objectId}`);
    } else if (objectType === 'SPACE') {
      redirect(`/projects/${objectId}`);
    } else {
      redirect('/');
    }
  }

  // Failure: render an error page.
  const t = await getTranslations('Guests');

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4 text-center">
      <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-8 py-10 max-w-md w-full">
        <h1 className="text-xl font-semibold text-destructive mb-2">
          {t('acceptFailedTitle')}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t('acceptFailedBody')}
        </p>
      </div>
    </div>
  );
}
