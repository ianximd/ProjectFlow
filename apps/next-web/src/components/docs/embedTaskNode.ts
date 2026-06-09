import { Node, mergeAttributes } from '@tiptap/core';

/**
 * Inline-block node: `embedTask` with a `taskId` attribute.
 * Serialises to/from `<div data-embed-task data-task-id="...">` for the
 * ProseMirror-JSON snapshot stored on the API side.
 * A React node view (live TaskCard) can be registered in DocEditor via
 * ReactNodeViewRenderer once the TaskCard component is exposable.
 */
export const EmbedTask = Node.create({
  name: 'embedTask',
  group: 'block',
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      taskId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-task-id'),
        renderHTML: (attrs) =>
          attrs.taskId ? { 'data-task-id': attrs.taskId } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-embed-task]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-embed-task': '' })];
  },
});
