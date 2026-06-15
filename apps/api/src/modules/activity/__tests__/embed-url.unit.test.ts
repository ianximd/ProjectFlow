import { describe, expect, it } from 'vitest';
import { normalizeEmbedUrl, EmbedUrlError } from '../embed-url.js';

describe('normalizeEmbedUrl', () => {
  // ── happy-path ──────────────────────────────────────────────────────────────

  it('accepts an https URL and returns it normalised', () => {
    const out = normalizeEmbedUrl('https://example.com/embed');
    expect(out).toBe('https://example.com/embed');
  });

  it('accepts an http URL', () => {
    const out = normalizeEmbedUrl('http://example.com/embed');
    expect(out).toBe('http://example.com/embed');
  });

  it('strips a trailing fragment', () => {
    const out = normalizeEmbedUrl('https://example.com/embed#section');
    expect(out).toBe('https://example.com/embed');
  });

  it('preserves query strings', () => {
    const out = normalizeEmbedUrl('https://example.com/embed?foo=bar&baz=1');
    expect(out).toBe('https://example.com/embed?foo=bar&baz=1');
  });

  // ── reject-list ─────────────────────────────────────────────────────────────

  it('rejects javascript: scheme', () => {
    expect(() => normalizeEmbedUrl('javascript:alert(1)')).toThrow(EmbedUrlError);
  });

  it('rejects data: scheme', () => {
    expect(() => normalizeEmbedUrl('data:text/html,<h1>hi</h1>')).toThrow(EmbedUrlError);
  });

  it('rejects file: scheme', () => {
    expect(() => normalizeEmbedUrl('file:///etc/passwd')).toThrow(EmbedUrlError);
  });

  it('rejects blob: scheme', () => {
    expect(() => normalizeEmbedUrl('blob:https://example.com/uuid')).toThrow(EmbedUrlError);
  });

  it('rejects a bare string that is not a URL', () => {
    expect(() => normalizeEmbedUrl('not a url at all')).toThrow(EmbedUrlError);
  });

  it('rejects an empty string', () => {
    expect(() => normalizeEmbedUrl('')).toThrow(EmbedUrlError);
  });

  it('rejects ftp: scheme', () => {
    expect(() => normalizeEmbedUrl('ftp://files.example.com/pub')).toThrow(EmbedUrlError);
  });

  it('returns a string type', () => {
    const out = normalizeEmbedUrl('https://app.example.com/view?id=123');
    expect(typeof out).toBe('string');
  });

  // ── adversarial / obfuscation cases ─────────────────────────────────────────

  it('rejects vbscript: scheme', () => {
    expect(() => normalizeEmbedUrl('vbscript:msgbox(1)')).toThrow(EmbedUrlError);
  });

  it('rejects scheme-relative URLs (//example.com/x)', () => {
    expect(() => normalizeEmbedUrl('//example.com/x')).toThrow(EmbedUrlError);
  });

  it('rejects case/whitespace-obfuscated javascript: scheme', () => {
    expect(() => normalizeEmbedUrl('  JaVaScRiPt:alert(1)')).toThrow(EmbedUrlError);
  });
});
