'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Tldraw, type Editor, type TLShape } from 'tldraw';
import type { WhiteboardTaskLink } from '@projectflow/types';
import 'tldraw/tldraw.css';
import { useWhiteboardYProvider } from './useWhiteboardYProvider';
import { bindTldrawToYjs } from './yjsBinding';
import { ConvertToTaskPanel } from './ConvertToTaskPanel';
import styles from './WhiteboardCanvas.module.css';

export interface WhiteboardCanvasProps {
  whiteboardId: string;
  scopeId: string;
  scopeType: string;
  initialDocJson: string | null;
  links: WhiteboardTaskLink[];
  lists: { id: string; name: string }[];
}

/**
 * The collaborative whiteboard surface. Mounts tldraw, binds its store to the
 * shared Y.Doc (so two browsers on `whiteboard:<id>` converge), tracks the single
 * selected shape, and offers convert-to-task on it. Existing task links render as
 * simple embed cards (full custom embed-shape rendering is deferred).
 */
export function WhiteboardCanvas({
  whiteboardId,
  initialDocJson,
  links,
  lists,
}: WhiteboardCanvasProps): React.JSX.Element {
  const t = useTranslations('Whiteboard');
  const handle = useWhiteboardYProvider(whiteboardId);
  const editorRef = useRef<Editor | null>(null);
  // Holds the unsubscribe fn for the selection store.listen — set inside
  // handleMount (which tldraw calls with void return, so cleanup must live here).
  const selectionOffRef = useRef<(() => void) | null>(null);
  const [selectedShape, setSelectedShape] = useState<TLShape | null>(null);

  // (Re)bind whenever the editor is mounted AND the Yjs doc is ready. The binding
  // is torn down + rebuilt if doc changes (e.g. provider reconnect).
  const doc = handle?.doc ?? null;
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !doc) return;
    const unbind = bindTldrawToYjs(editor, doc, initialDocJson);
    return () => {
      unbind();
    };
    // initialDocJson is intentionally omitted — it is only meaningful on the
    // first bind (empty-room seed) and must not re-trigger on RSC revalidation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc]);

  // tldraw's onMount type is (editor) => void; the returned cleanup is silently
  // discarded, so we store refs here and tear them down in a dedicated effect.
  const handleMount = useCallback((editor: Editor) => {
    editorRef.current = editor;

    // Track the single-selected shape reactively. Selection lives in the
    // session-scoped store, so listen across all scopes and re-read.
    const update = (): void => setSelectedShape(editor.getOnlySelectedShape());
    update();
    selectionOffRef.current = editor.store.listen(update, { scope: 'all', source: 'all' });
  }, []);

  // Dedicated teardown effect: unsubscribes the selection listener and clears
  // the editor ref when the component unmounts. Runs after the Yjs bind effect
  // (React runs cleanups in reverse order) so no setState fires on an unmounted
  // component and no store listeners are left active after navigation.
  useEffect(() => {
    return () => {
      selectionOffRef.current?.();
      selectionOffRef.current = null;
      editorRef.current = null;
    };
  }, []);

  const handleConverted = useCallback(() => {
    // Deselect so the panel closes; the new link will appear after revalidation.
    editorRef.current?.selectNone();
    setSelectedShape(null);
  }, []);

  const connected = handle?.connected ?? false;

  return (
    <div className={styles.root}>
      <div className={styles.canvas}>
        <Tldraw onMount={handleMount} />
      </div>

      {!connected && <div className={styles.status}>{t('connecting')}</div>}

      {links.length > 0 && (
        <div className={styles.embeds} aria-label={t('linkedTasks')}>
          {links.map((link) => (
            <a
              key={link.id}
              className={styles.embedCard}
              href={`/tasks/${link.taskId}`}
              title={link.taskTitle}
            >
              <span className={styles.embedKey}>{link.taskIssueKey}</span>
              <span>{link.taskTitle}</span>
            </a>
          ))}
        </div>
      )}

      {selectedShape && (
        <ConvertToTaskPanel
          whiteboardId={whiteboardId}
          lists={lists}
          shape={selectedShape}
          onConverted={handleConverted}
        />
      )}
    </div>
  );
}
