import { describe, expect, it } from 'vitest';
import { validateFieldValue } from '../validators.js';
import type { CustomFieldConfig, CustomFieldType } from '@projectflow/types';

function ok(type: CustomFieldType, value: unknown, config: CustomFieldConfig | null = null) {
  return validateFieldValue(type, value, config);
}

describe('validateFieldValue', () => {
  it('text accepts a string, rejects a number', () => {
    expect(ok('text', 'hi').valid).toBe(true);
    expect(ok('text', 42).valid).toBe(false);
  });
  it('url requires a parseable URL', () => {
    expect(ok('url', 'https://x.com').valid).toBe(true);
    expect(ok('url', 'not a url').valid).toBe(false);
  });
  it('email requires an email shape', () => {
    expect(ok('email', 'a@b.co').valid).toBe(true);
    expect(ok('email', 'nope').valid).toBe(false);
  });
  it('number rejects NaN/non-number', () => {
    expect(ok('number', 3.5).valid).toBe(true);
    expect(ok('number', 'x').valid).toBe(false);
  });
  it('currency requires a valid ISO-4217 code in config', () => {
    expect(ok('currency', 10, { currencyCode: 'USD' }).valid).toBe(true);
    expect(ok('currency', 10, { currencyCode: 'ZZZ' }).valid).toBe(false);
  });
  it('checkbox requires boolean', () => {
    expect(ok('checkbox', true).valid).toBe(true);
    expect(ok('checkbox', 'true').valid).toBe(false);
  });
  it('date requires a parseable ISO date', () => {
    expect(ok('date', '2026-06-04T00:00:00.000Z').valid).toBe(true);
    expect(ok('date', 'whenever').valid).toBe(false);
  });
  it('dropdown requires an existing option id', () => {
    const cfg = { options: [{ id: 'o1', name: 'A', color: null }] };
    expect(ok('dropdown', 'o1', cfg).valid).toBe(true);
    expect(ok('dropdown', 'oX', cfg).valid).toBe(false);
  });
  it('labels requires all ids to exist', () => {
    const cfg = { options: [{ id: 'o1', name: 'A', color: null }, { id: 'o2', name: 'B', color: null }] };
    expect(ok('labels', ['o1', 'o2'], cfg).valid).toBe(true);
    expect(ok('labels', ['o1', 'oX'], cfg).valid).toBe(false);
  });
  it('rating requires integer 0..max', () => {
    expect(ok('rating', 3, { max: 5 }).valid).toBe(true);
    expect(ok('rating', 9, { max: 5 }).valid).toBe(false);
  });
  it('progress_manual requires integer 0..100', () => {
    expect(ok('progress_manual', 50).valid).toBe(true);
    expect(ok('progress_manual', 150).valid).toBe(false);
  });
  it('progress_auto rejects any direct write', () => {
    expect(ok('progress_auto', 50).valid).toBe(false);
    expect(ok('progress_auto', 50).code).toBe('PROGRESS_AUTO_READONLY');
  });
  it('people requires an array of strings (membership checked in the service)', () => {
    expect(ok('people', ['u1', 'u2']).valid).toBe(true);
    expect(ok('people', 'u1').valid).toBe(false);
  });
});
