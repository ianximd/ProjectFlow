import { describe, it, expect } from 'vitest';

import { guardedEventStream } from '../sse-stream.js';

const enc = new TextEncoder();

/** Drain a stream to an array of decoded string chunks. */
async function drain(stream: ReadableStream<Uint8Array>): Promise<string[]> {
  const reader = stream.getReader();
  const dec = new TextDecoder();
  const out: string[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out.push(dec.decode(value));
  }
  return out;
}

describe('guardedEventStream', () => {
  describe('passthrough', () => {
    it('emits source chunks in order and closes when the source closes', async () => {
      const src = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(enc.encode('event: a\n'));
          controller.enqueue(enc.encode('event: b\n'));
          controller.enqueue(enc.encode('event: c\n'));
          controller.close();
        },
      });

      const chunks = await drain(guardedEventStream(src));
      expect(chunks).toEqual(['event: a\n', 'event: b\n', 'event: c\n']);
    });

    it('streams lazily (pull-based) without draining the whole source upfront', async () => {
      let pulls = 0;
      const TOTAL = 100;
      const src = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (pulls < TOTAL) {
            controller.enqueue(enc.encode(`n${pulls}`));
            pulls += 1;
          } else {
            controller.close();
          }
        },
      });

      const wrapped = guardedEventStream(src);
      const reader = wrapped.getReader();

      const first = await reader.read();
      expect(first).toEqual({ done: false, value: enc.encode('n0') });
      // A pull-based proxy reads at most one chunk ahead (highWaterMark 1) — it
      // must NOT have eagerly drained all 100 source chunks into a buffer.
      expect(pulls).toBeLessThanOrEqual(2);

      const second = await reader.read();
      expect(second).toEqual({ done: false, value: enc.encode('n1') });
      expect(pulls).toBeLessThanOrEqual(3);
    });
  });

  describe('idempotent teardown', () => {
    it('does not throw when getReader().cancel() is called twice', async () => {
      const src = new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(enc.encode('x'));
        },
      });

      const reader = guardedEventStream(src).getReader();
      await expect(reader.cancel('first')).resolves.toBeUndefined();
      await expect(reader.cancel('second')).resolves.toBeUndefined();
    });

    it('does not throw when cancel() happens after the source already closed', async () => {
      const src = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(enc.encode('x'));
          controller.close();
        },
      });

      const wrapped = guardedEventStream(src);
      const reader = wrapped.getReader();
      // Drain to completion so the source is fully closed.
      await reader.read(); // 'x'
      const end = await reader.read();
      expect(end.done).toBe(true);
      // Cancelling a finished stream must be a silent no-op.
      await expect(reader.cancel('late')).resolves.toBeUndefined();
    });
  });

  describe('hostile source', () => {
    it('swallows a source whose cancel() throws synchronously', async () => {
      const src = new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(enc.encode('x'));
        },
        cancel() {
          throw new Error('ERR_INVALID_STATE: ReadableStream is already closed');
        },
      });

      const reader = guardedEventStream(src).getReader();
      await reader.read();
      await expect(reader.cancel('boom')).resolves.toBeUndefined();
    });

    it('swallows a source whose cancel() rejects', async () => {
      const src = new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(enc.encode('x'));
        },
        cancel() {
          return Promise.reject(new Error('async cancel failure'));
        },
      });

      const reader = guardedEventStream(src).getReader();
      await reader.read();
      await expect(reader.cancel('boom')).resolves.toBeUndefined();
    });

    it('closes the wrapper cleanly when the source pull() rejects', async () => {
      const src = new ReadableStream<Uint8Array>({
        pull() {
          return Promise.reject(new Error('upstream pull blew up'));
        },
      });

      const reader = guardedEventStream(src).getReader();
      // A read error in the source must surface as a graceful close (done),
      // never as a floating/unhandled rejection that crashes the process.
      const result = await reader.read();
      expect(result.done).toBe(true);
    });
  });
});
