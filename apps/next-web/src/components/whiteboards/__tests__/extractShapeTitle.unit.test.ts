import { describe, it, expect } from 'vitest';
import { extractShapeTitle, type WhiteboardShapeInput } from '../shape';

// Mirrors apps/api/src/modules/whiteboards/__tests__/shape.unit.test.ts so the
// client-side preview title stays identical to the server-derived task title.
describe('extractShapeTitle (client copy)', () => {
  it('reads a sticky note (props.text)', () => {
    const shape: WhiteboardShapeInput = { id: 'shape:1', type: 'note', props: { text: 'Ship the API' } };
    expect(extractShapeTitle(shape)).toBe('Ship the API');
  });

  it('reads tldraw rich-text (props.richText) by joining plain text runs', () => {
    const shape: WhiteboardShapeInput = {
      id: 'shape:4', type: 'note',
      props: { richText: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello ' }, { type: 'text', text: 'world' }] }] } },
    };
    expect(extractShapeTitle(shape)).toBe('Hello world');
  });

  it('trims whitespace and collapses newlines to spaces', () => {
    const shape: WhiteboardShapeInput = { id: 'shape:5', type: 'text', props: { text: '  multi\nline  ' } };
    expect(extractShapeTitle(shape)).toBe('multi line');
  });

  it('falls back to "Untitled" for an empty/whitespace shape', () => {
    expect(extractShapeTitle({ id: 'shape:7', type: 'note', props: { text: '   ' } })).toBe('Untitled');
    expect(extractShapeTitle({ id: 'shape:8', type: 'geo', props: {} })).toBe('Untitled');
  });

  it('clamps to 500 chars (the Tasks.Title cap)', () => {
    const shape: WhiteboardShapeInput = { id: 'shape:6', type: 'text', props: { text: 'x'.repeat(600) } };
    expect(extractShapeTitle(shape)).toHaveLength(500);
  });
});
