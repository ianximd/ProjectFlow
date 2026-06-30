'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { deleteForm } from '@/server/actions/forms';
import { notifyActionError } from '@/lib/apiErrorToast';

/** Inline delete affordance for a form row; confirms, then revalidates the list. */
export function DeleteFormButton({ formId }: { formId: string }) {
  const t = useTranslations('Forms');
  const router = useRouter();
  const [busy, start] = useTransition();
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => {
        if (!window.confirm(t('deleteFormConfirm'))) return;
        start(async () => {
          const r = await deleteForm(formId);
          if (!r.ok) {
            notifyActionError(r);
            return;
          }
          router.refresh();
        });
      }}
      style={{ background: 'none', border: 'none', padding: 0, color: 'var(--destructive)', cursor: 'pointer' }}
    >
      {t('deleteForm')}
    </button>
  );
}
