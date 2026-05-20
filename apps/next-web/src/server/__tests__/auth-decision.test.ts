import { describe, it, expect } from 'vitest';
import { decideAuth } from '../auth-decision';

describe('decideAuth', () => {
  it('redirects unauthenticated users away from protected routes', () => {
    expect(decideAuth('/board', false)).toBe('redirect-login');
    expect(decideAuth('/projects', false)).toBe('redirect-login');
  });
  it('allows unauthenticated users on public routes', () => {
    expect(decideAuth('/login', false)).toBe('allow');
    expect(decideAuth('/register', false)).toBe('allow');
    expect(decideAuth('/oauth/finish', false)).toBe('allow');
    expect(decideAuth('/', false)).toBe('allow');
  });
  it('bounces authenticated users off login/register/root', () => {
    expect(decideAuth('/login', true)).toBe('redirect-app');
    expect(decideAuth('/register', true)).toBe('redirect-app');
    expect(decideAuth('/', true)).toBe('redirect-app');
  });
  it('allows authenticated users on protected routes', () => {
    expect(decideAuth('/board', true)).toBe('allow');
    expect(decideAuth('/oauth/mfa', true)).toBe('allow');
  });
});
