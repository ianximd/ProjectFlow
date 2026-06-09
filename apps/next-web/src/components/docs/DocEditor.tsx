'use client';

import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCursor from '@tiptap/extension-collaboration-cursor';
import { useTranslations } from 'next-intl';
import { useCollabProvider } from '@/lib/collab/useCollabProvider';
import { EmbedTask } from './embedTaskNode';
import styles from './DocEditor.module.css';
import type { MeProfile } from '@/server/queries/profile';

interface Props {
  pageId: string;
  me: Pick<MeProfile, 'name'>;
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

export function DocEditor({ pageId, me }: Props) {
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
      <EditorContent editor={editor} />
    </div>
  );
}
