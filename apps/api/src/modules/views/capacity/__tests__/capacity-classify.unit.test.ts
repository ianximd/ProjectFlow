import { describe, it, expect } from 'vitest';
import { classifyCapacity } from '../capacity-classify.js';

describe('classifyCapacity', () => {
  it('flags over-capacity when assigned exceeds capacity', () => {
    const r = classifyCapacity(120, 100);
    expect(r.status).toBe('over');
    expect(r.ratio).toBeCloseTo(1.2);
  });

  it('reports under-capacity when assigned is below capacity', () => {
    const r = classifyCapacity(40, 100);
    expect(r.status).toBe('under');
    expect(r.ratio).toBeCloseTo(0.4);
  });

  it('reports at-capacity within the +/-2% tolerance band', () => {
    expect(classifyCapacity(100, 100).status).toBe('at');
    expect(classifyCapacity(101, 100).status).toBe('at'); // within 2%
    expect(classifyCapacity(103, 100).status).toBe('over'); // beyond 2%
  });

  it('treats any positive assignment against zero/absent capacity as over', () => {
    expect(classifyCapacity(10, 0).status).toBe('over');
    expect(classifyCapacity(10, 0).ratio).toBe(Infinity);
  });

  it('treats zero assignment against zero capacity as under with ratio 0', () => {
    const r = classifyCapacity(0, 0);
    expect(r.status).toBe('under');
    expect(r.ratio).toBe(0);
  });

  it('clamps negative inputs to zero', () => {
    expect(classifyCapacity(-5, 100).ratio).toBe(0);
  });
});
