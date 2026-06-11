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
  it('does not treat prefix-colliding paths as public', () => {
    expect(decideAuth('/loginx', false)).toBe('redirect-login');
    expect(decideAuth('/registrations', false)).toBe('redirect-login');
    expect(decideAuth('/oauthx', false)).toBe('redirect-login');
  });
  it('allows unauthenticated users on /oauth (exact prefix)', () => {
    expect(decideAuth('/oauth', false)).toBe('allow');
  });
  it('keeps authenticated users on /oauth/* and prefix-colliding paths', () => {
    expect(decideAuth('/oauth/finish', true)).toBe('allow');
    expect(decideAuth('/loginx', true)).toBe('allow');
  });
  it('treats the public form render route as public but keeps the authed forms surface protected', () => {
    expect(decideAuth('/forms/public', false)).toBe('allow');
    expect(decideAuth('/forms/public/my-intake', false)).toBe('allow');
    // The authed list + builder stay protected for unauthenticated users.
    expect(decideAuth('/forms', false)).toBe('redirect-login');
    expect(decideAuth('/forms/abc123', false)).toBe('redirect-login');
    // Prefix-colliding path is NOT public.
    expect(decideAuth('/forms/publicx', false)).toBe('redirect-login');
  });
});
