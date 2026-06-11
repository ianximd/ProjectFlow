import { describe, it, expect } from 'vitest';
import { extractShapeTitle, type WhiteboardShapeInput } from '../whiteboard.shape.js';

describe('extractShapeTitle', () => {
  it('reads a sticky note (props.text)', () => {
    const shape: WhiteboardShapeInput = { id: 'shape:1', type: 'note', props: { text: 'Ship the API' } };
    expect(extractShapeTitle(shape)).toBe('Ship the API');
  });

  it('reads a text shape (props.text)', () => {
    const shape: WhiteboardShapeInput = { id: 'shape:2', type: 'text', props: { text: 'Write tests' } };
    expect(extractShapeTitle(shape)).toBe('Write tests');
  });

  it('reads a geo shape label (props.text on a rectangle)', () => {
    const shape: WhiteboardShapeInput = { id: 'shape:3', type: 'geo', props: { geo: 'rectangle', text: 'Idea card' } };
    expect(extractShapeTitle(shape)).toBe('Idea card');
  });

  it('reads tldraw rich-text (props.richText) by joining plain text runs', () => {
    const shape: WhiteboardShapeInput = {
      id: 'shape:4', type: 'note',
      props: { richText: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello ' }, { type: 'text', text: 'world' }] }] } },
    };
    expect(extractShapeTitle(shape)).toBe('Hello world');
  });

  it('trims surrounding whitespace and collapses newlines to spaces', () => {
    const shape: WhiteboardShapeInput = { id: 'shape:5', type: 'text', props: { text: '  multi\nline  ' } };
    expect(extractShapeTitle(shape)).toBe('multi line');
  });

  it('clamps to 500 chars (the Tasks.Title cap)', () => {
    const long = 'x'.repeat(600);
    const shape: WhiteboardShapeInput = { id: 'shape:6', type: 'text', props: { text: long } };
    expect(extractShapeTitle(shape)).toHaveLength(500);
  });

  it('falls back to a default for an empty/whitespace shape', () => {
    expect(extractShapeTitle({ id: 'shape:7', type: 'note', props: { text: '   ' } })).toBe('Untitled');
    expect(extractShapeTitle({ id: 'shape:8', type: 'geo', props: {} })).toBe('Untitled');
  });
});
