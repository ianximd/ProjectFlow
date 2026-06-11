'use client';

import { useEffect, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import type { TLShape } from 'tldraw';
import { convertShapeToTask } from '@/server/actions/whiteboards';
import { notifyActionError } from '@/lib/apiErrorToast';
import { extractShapeTitle } from './shape';
import styles from './WhiteboardCanvas.module.css';

export interface ConvertToTaskPanelProps {
  whiteboardId: string;
  lists: { id: string; name: string }[];
  shape: TLShape;
  onConverted: () => void;
}

/**
 * Floating panel shown when exactly one shape is selected. Previews the title the
 * server will derive (extractShapeTitle, mirrored from the API), lets the user
 * pick a target List (passed down from the SSR page — never a client query), and
 * converts the shape into a Task via the convertShapeToTask server action.
 */
export function ConvertToTaskPanel({
  whiteboardId,
  lists,
  shape,
  onConverted,
}: ConvertToTaskPanelProps): React.JSX.Element {
  const t = useTranslations('Whiteboard');
  // Lazy initializer so React doesn't re-evaluate lists[0] on every render.
  const [targetListId, setTargetListId] = useState<string>(() => lists[0]?.id ?? '');

  // Keep the selected target in sync if the lists prop changes (e.g. after
  // the parent SSR page revalidates and passes a new list set).
  useEffect(() => {
    setTargetListId(lists[0]?.id ?? '');
  }, [lists]);
  const [pending, startTransition] = useTransition();

  // The selected tldraw shape is structurally { id, type, props } — exactly the
  // WhiteboardShapeInput the extractor reads.
  const title = extractShapeTitle({
    id: shape.id,
    type: shape.type,
    props: shape.props as Record<string, unknown>,
  });

  const noLists = lists.length === 0;

  function handleConvert(): void {
    if (noLists || !targetListId) return;
    startTransition(async () => {
      const res = await convertShapeToTask(whiteboardId, {
        targetListId,
        shapeId: shape.id,
        shape: {
          id: shape.id,
          type: shape.type,
          props: shape.props as Record<string, unknown>,
        },
      });
      if (!res.ok) {
        notifyActionError(res);
        return;
      }
      onConverted();
    });
  }

  return (
    <div className={styles.convertPanel} role="dialog" aria-label={t('convertToTask')}>
      <p className={styles.convertTitle} title={title}>
        {title}
      </p>

      {noLists ? (
        <p className={styles.convertHint}>{t('noLists')}</p>
      ) : (
        <label className={styles.convertField}>
          <span>{t('targetList')}</span>
          <select
            value={targetListId}
            onChange={(e) => setTargetListId(e.target.value)}
            disabled={pending}
          >
            {lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <button
        type="button"
        className={styles.convertButton}
        onClick={handleConvert}
        disabled={pending || noLists || !targetListId}
      >
        {pending ? t('converting') : t('convertToTask')}
      </button>
    </div>
  );
}
