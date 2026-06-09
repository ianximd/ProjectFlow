import type { Editor, Range } from '@tiptap/core';

export interface SlashItem {
  /** i18n key under the Docs.slash.* namespace */
  key: string;
  /** Executed when the user selects this item from the slash menu */
  run: (editor: Editor, range: Range) => void;
}

/**
 * Data-only slash-command catalog.
 * Labels come from `t('slash.<key>')` in the component layer (no i18n import
 * here keeps this module unit-testable without a Next.js provider).
 *
 * Live `@tiptap/suggestion` wiring is registered in DocEditor via a lightweight
 * Extension; this list is imported there so the set is a single source of truth.
 */
export const SLASH_ITEMS: SlashItem[] = [
  {
    key: 'h1',
    run: (e, r) =>
      e.chain().focus().deleteRange(r).toggleHeading({ level: 1 }).run(),
  },
  {
    key: 'h2',
    run: (e, r) =>
      e.chain().focus().deleteRange(r).toggleHeading({ level: 2 }).run(),
  },
  {
    key: 'bullet',
    run: (e, r) =>
      e.chain().focus().deleteRange(r).toggleBulletList().run(),
  },
  {
    key: 'ordered',
    run: (e, r) =>
      e.chain().focus().deleteRange(r).toggleOrderedList().run(),
  },
  {
    key: 'divider',
    run: (e, r) =>
      e.chain().focus().deleteRange(r).setHorizontalRule().run(),
  },
  {
    key: 'task',
    run: (e, r) =>
      e
        .chain()
        .focus()
        .deleteRange(r)
        .insertContent({ type: 'embedTask', attrs: { taskId: null } })
        .run(),
  },
];
