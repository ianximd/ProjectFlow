import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  registerCloser,
  runShutdown,
  _resetClosersForTest,
  isShuttingDown,
} from '../shutdown.js';

beforeEach(() => {
  _resetClosersForTest();
});

describe('shutdown registry', () => {
  it('runs closers in reverse-registration order', async () => {
    const order: string[] = [];
    registerCloser('first',  async () => { order.push('first'); });
    registerCloser('second', async () => { order.push('second'); });
    registerCloser('third',  async () => { order.push('third'); });

    await runShutdown('test');
    expect(order).toEqual(['third', 'second', 'first']);
  });

  it('isolates failures — one throw does not stop others', async () => {
    const order: string[] = [];
    registerCloser('a', async () => { order.push('a'); });
    registerCloser('b', async () => { throw new Error('boom'); });
    registerCloser('c', async () => { order.push('c'); });

    await runShutdown('test');
    expect(order).toEqual(['c', 'a']);
  });

  it('is idempotent — second call returns the same in-flight promise', async () => {
    let calls = 0;
    registerCloser('once', async () => { calls += 1; });

    const a = runShutdown('first');
    const b = runShutdown('second');
    expect(a).toBe(b);
    await a;
    expect(calls).toBe(1);
  });

  it('flips isShuttingDown to true', async () => {
    expect(isShuttingDown()).toBe(false);
    const done = runShutdown('test');
    expect(isShuttingDown()).toBe(true);
    await done;
  });

  it('times out a stuck closer after 10s without blocking peers', async () => {
    vi.useFakeTimers();
    const order: string[] = [];
    registerCloser('fast', async () => { order.push('fast'); });
    registerCloser('stuck', () => new Promise(() => { /* never resolves */ }));

    const done = runShutdown('test');
    await vi.advanceTimersByTimeAsync(11_000);
    await done;
    expect(order).toEqual(['fast']);
    vi.useRealTimers();
  });
});
