import { describe, it, expect } from 'vitest';
import { SUPPORTED_LOCALES, DEFAULT_LOCALE, normalizeLocale } from '../locale';

describe('normalizeLocale', () => {
  it('returns the locale when supported', () => {
    expect(normalizeLocale('id')).toBe('id');
    expect(normalizeLocale('en')).toBe('en');
  });

  it('falls back to default for unsupported or missing values', () => {
    expect(normalizeLocale('fr')).toBe(DEFAULT_LOCALE);
    expect(normalizeLocale(undefined)).toBe(DEFAULT_LOCALE);
    expect(normalizeLocale('')).toBe(DEFAULT_LOCALE);
    expect(normalizeLocale(null)).toBe(DEFAULT_LOCALE);
  });

  it('trims surrounding whitespace before matching', () => {
    expect(normalizeLocale(' en ')).toBe('en');
    expect(normalizeLocale(' id')).toBe('id');
    expect(normalizeLocale(' id-ID ')).toBe('id');
  });

  it('lowercases and strips region subtags', () => {
    expect(normalizeLocale('EN')).toBe('en');
    expect(normalizeLocale('id-ID')).toBe('id');
  });

  it('exposes exactly en and id as supported', () => {
    expect([...SUPPORTED_LOCALES].sort()).toEqual(['en', 'id']);
  });
});
