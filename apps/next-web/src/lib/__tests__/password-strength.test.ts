import { describe, it, expect } from 'vitest';
import { scorePassword } from '../password-strength';

describe('scorePassword', () => {
  it('returns score 0 / weak for an empty password', () => {
    expect(scorePassword('')).toEqual({ score: 0, level: 'weak' });
  });

  it('treats anything shorter than 8 chars as weak regardless of variety', () => {
    expect(scorePassword('Ab1!')).toEqual({ score: 1, level: 'weak' });
    expect(scorePassword('abcdefg')).toEqual({ score: 1, level: 'weak' });
  });

  it('rates an 8-char single-class password weak', () => {
    expect(scorePassword('abcdefgh')).toEqual({ score: 1, level: 'weak' });
  });

  it('rates two character classes as fair', () => {
    expect(scorePassword('abcdefg1')).toEqual({ score: 2, level: 'fair' });
  });

  it('rates three character classes as good', () => {
    expect(scorePassword('Abcdefg1')).toEqual({ score: 3, level: 'good' });
  });

  it('rates all four character classes as strong', () => {
    expect(scorePassword('Abcdef1!')).toEqual({ score: 4, level: 'strong' });
  });
});
