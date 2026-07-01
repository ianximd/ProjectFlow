'use client';

import { useState, useTransition } from 'react';
import { useEditor, EditorContent, BubbleMenu, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCursor from '@tiptap/extension-collaboration-cursor';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { useCollabProvider } from '@/lib/collab/useCollabProvider';
import { createTaskFromSelection } from '@/server/actions/docs';
import { notifyActionError } from '@/lib/apiErrorToast';
import { EmbedTask } from './embedTaskNode';
import styles from './DocEditor.module.css';
import type { MeProfile } from '@/server/queries/profile';
import type { DocScopeType } from '@projectflow/types';

interface Props {
  pageId: string;
  me: Pick<MeProfile, 'name'>;
  scopeType: DocScopeType;
  scopeId: string;
  lists: { id: string; name: string }[];
}

const CURSOR_COLORS = [
  '#ef4444',
  '#f59e0b',
  '#10b981',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
];

const colorFor = (name: string) =>
  CURSOR_COLORS[
    [...name].reduce((a, c) => a + c.charCodeAt(0), 0) % CURSOR_COLORS.length
  ];

/** Read the trimmed plain text of the current selection (empty string if none). */
function selectionText(editor: Editor): string {
  const { from, to, empty } = editor.state.selection;
  if (empty) return '';
  return editor.state.doc.textBetween(from, to, ' ').trim();
}

export function DocEditor({ pageId, me, scopeType, scopeId, lists }: Props) {
  const t = useTranslations('Docs');
  const handle = useCollabProvider(pageId);

  // useEditor does not accept null — always called with an options object.
  // When handle is not yet available we render StarterKit only (no collab
  // extensions) so TipTap initialises without error. Once the provider is
  // ready the deps array change causes the editor to be destroyed+recreated
  // with the full collab extension set (Yjs becomes the source of truth).
  //
  // CRITICAL: field: 'prosemirror' matches the Yjs XML-fragment name used by
  // the API collab server when persisting BodyJson. Omitting this would make
  // the snapshot empty (silent data bug).
  const editor = useEditor(
    handle
      ? {
          extensions: [
            StarterKit.configure({ history: false }),
            EmbedTask,
            Collaboration.configure({ document: handle.doc, field: 'prosemirror' }),
            CollaborationCursor.configure({
              provider: handle.provider,
              user: { name: me.name, color: colorFor(me.name) },
            }),
          ],
          editorProps: {
            attributes: {
              class: styles.prose,
              'aria-label': t('editor'),
            },
          },
          immediatelyRender: false,
        }
      : {
          extensions: [StarterKit.configure({ history: false }), EmbedTask],
          editorProps: {
            attributes: {
              class: styles.prose,
              'aria-label': t('editor'),
            },
          },
          immediatelyRender: false,
        },
    [handle, pageId],
  );

  if (!handle || !editor) {
    return <div className={styles.loading}>{t('connecting')}</div>;
  }

  return (
    <div className={styles.root} data-doc-editor>
      <BubbleMenu
        editor={editor}
        shouldShow={({ editor }) => selectionText(editor).length > 0}
      >
        <CreateTaskBubble
          editor={editor}
          pageId={pageId}
          scopeType={scopeType}
          scopeId={scopeId}
          lists={lists}
        />
      </BubbleMenu>
      <EditorContent editor={editor} />
    </div>
  );
}

interface BubbleProps {
  editor: Editor;
  pageId: string;
  scopeType: DocScopeType;
  scopeId: string;
  lists: { id: string; name: string }[];
}

/**
 * Selection toolbar action that turns the highlighted text into a task via the
 * existing create-task-from-selection endpoint. LIST-scoped docs create
 * straight into the doc's own list (zero friction); SPACE/FOLDER docs first
 * reveal a list picker since there is no single implied target.
 */
function CreateTaskBubble({ editor, pageId, scopeType, scopeId, lists }: BubbleProps) {
  const t = useTranslations('Docs');
  const [pending, start] = useTransition();
  const [picking, setPicking] = useState(false);
  const [listId, setListId] = useState<string>(lists[0]?.id ?? '');

  const create = (targetListId: string) =>
    start(async () => {
      const title = selectionText(editor);
      if (!title || !targetListId) return;
      const r = await createTaskFromSelection(pageId, targetListId, title);
      if (!r.ok) {
        notifyActionError(r as { error: string; code?: string; status?: number });
        return;
      }
      setPicking(false);
      toast.success(t('createTaskSuccess'));
    });

  // LIST-scoped: the doc lives in a list, so create directly into it.
  if (scopeType === 'LIST') {
    return (
      <button
        type="button"
        className={styles.bubbleButton}
        disabled={pending}
        onClick={() => create(scopeId)}
      >
        ✓ {t('createTask')}
      </button>
    );
  }

  if (lists.length === 0) {
    return <span className={styles.bubbleNote}>{t('createTaskNoLists')}</span>;
  }

  if (!picking) {
    return (
      <button
        type="button"
        className={styles.bubbleButton}
        disabled={pending}
        onClick={() => setPicking(true)}
      >
        ✓ {t('createTask')}
      </button>
    );
  }

  return (
    <div className={styles.bubblePicker}>
      <label className={styles.bubbleLabel}>
        {t('createTaskListLabel')}
        <select
          value={listId}
          onChange={(e) => setListId(e.target.value)}
          disabled={pending}
        >
          {lists.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className={styles.bubbleButton}
        disabled={pending || !listId}
        onClick={() => create(listId)}
      >
        {t('createTaskConfirm')}
      </button>
      <button
        type="button"
        className={styles.bubbleButtonGhost}
        disabled={pending}
        onClick={() => setPicking(false)}
      >
        {t('createTaskCancel')}
      </button>
    </div>
  );
}
