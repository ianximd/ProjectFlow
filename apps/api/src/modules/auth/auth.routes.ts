import { Hono } from 'hono';
import { setCookie, getCookie, deleteCookie } from 'hono/cookie';
import { AuthRepository } from './auth.repository.js';
import { AuthService } from './auth.service.js';
import { authMiddleware } from './auth.middleware.js';
import { isTrustedBff } from './bff.js';
import { roleService } from '../roles/role.service.js';
import { OAuthService } from './oauth/service.js';
import { getEnabledProviders } from './oauth/registry.js';
import { adminService } from '../admin/admin.service.js';

const authRepo = new AuthRepository();
const authService = new AuthService(authRepo);
const oauthService = new OAuthService({ authService });

const REFRESH_COOKIE = 'refresh_token';
const isProduction = process.env.NODE_ENV === 'production';

function setRefreshCookie(c: any, token: string) {
  setCookie(c, REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'Strict',
    maxAge: 7 * 24 * 60 * 60, // 7 days in seconds
    path: '/api/v1/auth',
  });
}

/**
 * The audit middleware only fires on POST/PATCH/PUT/DELETE; OAuth callbacks
 * arrive as GETs. Pull the same connection metadata the middleware does so
 * oauth.* events look the same as the ones the middleware emits.
 */
function clientMeta(c: any) {
  const ip        = c.req.header('CF-Connecting-IP')
                 || c.req.header('X-Forwarded-For')?.split(',')[0]?.trim()
                 || null;
  const userAgent = c.req.header('User-Agent')?.slice(0, 512) ?? null;
  return { ip, userAgent };
}

export const authRoutes = new Hono();

// POST /api/v1/auth/register
authRoutes.post('/register', async (c) => {
  const { email, name, password } = await c.req.json();
  if (!email || !name || !password) {
    return c.json({ error: { message: 'Missing required fields' } }, 400);
  }

  try {
    const user = await authService.register(email, name, password);
    const { PasswordHash, MfaSecret, ...userSafe } = user as any;
    return c.json({ data: userSafe }, 201);
  } catch (error: any) {
    if (error.number === 50001) {
      return c.json({ error: { message: error.message } }, 409);
    }
    return c.json({ error: { message: 'Internal Server Error' } }, 500);
  }
});

// POST /api/v1/auth/login
authRoutes.post('/login', async (c) => {
  const { email, password } = await c.req.json();
  if (!email || !password) {
    return c.json({ error: { message: 'Missing credentials' } }, 400);
  }

  const result = await authService.login(email, password);
  if (result === 'locked') {
    return c.json(
      { error: { code: 'ACCOUNT_LOCKED', message: 'Account temporarily locked due to too many failed attempts. Try again in 15 minutes.', statusCode: 429 } },
      429,
    );
  }
  if (!result) {
    return c.json({ error: { message: 'Invalid credentials' } }, 401);
  }

  if (result.kind === 'mfa-required') {
    // Step one done — client must POST the TOTP/recovery code to /auth/mfa/challenge.
    return c.json({ data: { mfaRequired: true, mfaToken: result.mfaToken } });
  }

  // Refresh token is delivered via httpOnly cookie — never exposed to browsers.
  // Trusted BFF callers also get it in the body so Next can own the session.
  setRefreshCookie(c, result.refreshToken);
  const loginBody: any = { user: result.user, token: result.accessToken };
  if (isTrustedBff(c.req.header('X-BFF-Secret'))) loginBody.refreshToken = result.refreshToken;
  return c.json({ data: loginBody });
});

// POST /api/v1/auth/mfa/challenge
// Step two of MFA login. Body: { mfaToken, code? , recoveryCode? }
authRoutes.post('/mfa/challenge', async (c) => {
  const { mfaToken, code, recoveryCode } = await c.req.json();
  if (!mfaToken || (!code && !recoveryCode)) {
    return c.json({ error: { message: 'mfaToken and code (or recoveryCode) are required' } }, 400);
  }
  const result = await authService.mfaChallenge(mfaToken, { code, recoveryCode });
  if (result === 'invalid-token') return c.json({ error: { message: 'Invalid or expired MFA challenge' } }, 401);
  if (result === 'invalid-code')  return c.json({ error: { message: 'Invalid MFA code' } }, 401);

  setRefreshCookie(c, result.refreshToken);
  const mfaBody: any = { user: result.user, token: result.accessToken };
  if (isTrustedBff(c.req.header('X-BFF-Secret'))) mfaBody.refreshToken = result.refreshToken;
  return c.json({ data: mfaBody });
});

// POST /api/v1/auth/mfa/setup  (protected) — generates pending TOTP secret + otpauth URI
authRoutes.post('/mfa/setup', authMiddleware, async (c) => {
  const jwtPayload = (c as any).get('user') as any;
  try {
    const { secret, otpauthUri } = await authService.setupMfa(jwtPayload.userId, jwtPayload.email);
    return c.json({ data: { secret, otpauthUri } });
  } catch (err: any) {
    // SP raises 51020 when MFA is already enabled
    if (err.number === 51020) return c.json({ error: { message: err.message } }, 409);
    return c.json({ error: { message: 'Internal Server Error' } }, 500);
  }
});

// POST /api/v1/auth/mfa/verify-setup  (protected) — { code }; on success returns recoveryCodes (one-time view)
authRoutes.post('/mfa/verify-setup', authMiddleware, async (c) => {
  const { code } = await c.req.json();
  if (!code) return c.json({ error: { message: 'code is required' } }, 400);
  const jwtPayload = (c as any).get('user') as any;
  const result = await authService.verifyMfaSetup(jwtPayload.userId, code);
  if (!result) return c.json({ error: { message: 'Invalid setup code or no pending enrolment' } }, 400);
  return c.json({ data: { enabled: true, recoveryCodes: result.recoveryCodes } });
});

// POST /api/v1/auth/mfa/disable  (protected) — { password, code } (TOTP or recovery)
authRoutes.post('/mfa/disable', authMiddleware, async (c) => {
  const { password, code } = await c.req.json();
  if (!password || !code) return c.json({ error: { message: 'password and code are required' } }, 400);
  const jwtPayload = (c as any).get('user') as any;
  const result = await authService.disableMfa(jwtPayload.userId, password, code);
  if (result === 'invalid-password') return c.json({ error: { message: 'Invalid password' } }, 401);
  if (result === 'invalid-code')     return c.json({ error: { message: 'Invalid MFA code' } }, 401);
  return c.json({ data: { enabled: false } });
});

// GET /api/v1/auth/me  (protected)
authRoutes.get('/me', authMiddleware, async (c) => {
  const jwtPayload = (c as any).get('user') as any;
  const user = await authService.getMe(jwtPayload.userId);
  if (!user) return c.json({ error: { message: 'User not found' } }, 404);
  return c.json({ data: user });
});

// PATCH /api/v1/auth/me  (protected) — edit own name and/or avatar.
// Other identity fields (email, password) have their own dedicated endpoints
// because they need extra verification.
authRoutes.patch('/me', authMiddleware, async (c) => {
  const jwtPayload = (c as any).get('user') as any;
  let body: any;
  try { body = await c.req.json(); }
  catch { return c.json({ error: { message: 'Invalid JSON body' } }, 400); }

  const fields: { name?: string; avatarUrl?: string | null } = {};

  if (typeof body?.name === 'string') {
    const n = body.name.trim();
    if (!n)               return c.json({ error: { message: 'Name cannot be empty' } }, 400);
    if (n.length > 255)   return c.json({ error: { message: 'Name too long (max 255 chars)' } }, 400);
    fields.name = n;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'avatarUrl')) {
    const v = body.avatarUrl;
    if (v == null || v === '') {
      fields.avatarUrl = null;
    } else if (typeof v === 'string' && v.length <= 500) {
      fields.avatarUrl = v;
    } else {
      return c.json({ error: { message: 'avatarUrl must be a string up to 500 chars or null' } }, 400);
    }
  }

  if (Object.keys(fields).length === 0) {
    return c.json({ error: { message: 'No editable fields provided' } }, 400);
  }

  const updated = await authService.updateProfile(jwtPayload.userId, fields);
  if (!updated) return c.json({ error: { message: 'User not found' } }, 404);
  return c.json({ data: updated });
});

// POST /api/v1/auth/change-password  (protected) — rotate own password.
// The current password is verified before the new one is written so a stolen
// access token alone can't lock the real owner out.
authRoutes.post('/change-password', authMiddleware, async (c) => {
  const jwtPayload = (c as any).get('user') as any;
  let body: any;
  try { body = await c.req.json(); }
  catch { return c.json({ error: { message: 'Invalid JSON body' } }, 400); }

  const current = String(body?.currentPassword ?? '');
  const next    = String(body?.newPassword ?? '');
  if (!current || !next) {
    return c.json({ error: { message: 'currentPassword and newPassword are required' } }, 400);
  }
  if (next.length < 8) {
    return c.json({ error: { message: 'newPassword must be at least 8 characters' } }, 400);
  }
  if (next === current) {
    return c.json({ error: { message: 'New password must differ from the current one' } }, 400);
  }

  const result = await authService.changePassword(jwtPayload.userId, current, next);
  if (result === 'no-user') {
    return c.json({ error: { message: 'User not found' } }, 404);
  }
  if (result === 'no-password') {
    return c.json({ error: { code: 'NO_PASSWORD_SET', message: 'No password set on this account. Use the forgot-password flow to set one.' } }, 409);
  }
  if (result === 'invalid-current') {
    return c.json({ error: { code: 'INVALID_CREDENTIALS', message: 'Current password is incorrect' } }, 401);
  }
  return c.json({ data: { ok: true } });
});

// GET /api/v1/auth/me/permissions?workspaceId=  (protected)
// Returns the current user's effective permission slugs (system + given workspace).
// Drives the frontend <PermissionGate> component.
authRoutes.get('/me/permissions', authMiddleware, async (c) => {
  const jwtPayload = (c as any).get('user') as any;
  const wsId = c.req.query('workspaceId') || null;
  const slugs = await roleService.getUserPermissionSlugs(jwtPayload.userId, wsId);
  const roles = await roleService.listUserRoles(jwtPayload.userId, wsId);
  return c.json({
    data: {
      workspaceId: wsId,
      permissions: Array.from(slugs),
      roles: roles.map((r) => ({
        slug:        r.roleSlug,
        name:        r.roleName,
        scope:       r.roleScope,
        workspaceId: r.workspaceId,
      })),
    },
  });
});

// POST /api/v1/auth/refresh
// Reads refresh token from httpOnly cookie; returns a new access token and rotates the cookie
authRoutes.post('/refresh', async (c) => {
  const rawToken = getCookie(c, REFRESH_COOKIE);
  if (!rawToken) {
    return c.json({ error: { message: 'Refresh token required' } }, 401);
  }

  const result = await authService.refreshAccessToken(rawToken);
  if (!result) {
    deleteCookie(c, REFRESH_COOKIE, { path: '/api/v1/auth' });
    return c.json({ error: { message: 'Invalid or expired refresh token' } }, 401);
  }

  setRefreshCookie(c, result.refreshToken);
  const refreshBody: any = { token: result.accessToken };
  if (isTrustedBff(c.req.header('X-BFF-Secret'))) refreshBody.refreshToken = result.refreshToken;
  return c.json({ data: refreshBody });
});

// POST /api/v1/auth/logout
authRoutes.post('/logout', async (c) => {
  deleteCookie(c, REFRESH_COOKIE, { path: '/api/v1/auth' });
  return c.json({ data: { message: 'Logged out successfully' } });
});

// POST /api/v1/auth/forgot-password
// Looks up the user and generates a time-limited reset token (1 hour).
// NOTE: The reset token is intentionally NOT returned in the response in production.
// Wire up a mailer (Resend / Nodemailer) to deliver it via email.
authRoutes.post('/forgot-password', async (c) => {
  const { email } = await c.req.json();
  if (!email) return c.json({ error: { message: 'Email is required' } }, 400);

  const result = await authService.forgotPassword(email);

  // Always respond with 200 to prevent user enumeration
  const response: Record<string, string> = {
    message: 'If that email exists, a reset link has been sent.',
  };

  // Expose the raw token only in non-production environments (for testing / dev)
  if (result && process.env.NODE_ENV !== 'production') {
    response.resetToken = result.resetToken;
  }

  return c.json({ data: response });
});

// POST /api/v1/auth/reset-password
authRoutes.post('/reset-password', async (c) => {
  const { token, password } = await c.req.json();
  if (!token || !password) {
    return c.json({ error: { message: 'Token and new password are required' } }, 400);
  }
  if (password.length < 8) {
    return c.json({ error: { message: 'Password must be at least 8 characters' } }, 400);
  }

  const ok = await authService.resetPassword(token, password);
  if (!ok) {
    return c.json({ error: { message: 'Invalid, expired, or already-used reset token' } }, 400);
  }

  return c.json({ data: { message: 'Password updated successfully. Please log in.' } });
});


// ─── OAuth ─────────────────────────────────────────────────────────────────
//
// Phase 1.A: Google sign-in (anonymous flow only — link/unlink + multiple
// providers ship in 1.B/1.C). Boots cleanly when no provider creds are
// configured: GET /providers returns [] and the login page hides every
// social button.

// GET /api/v1/auth/oauth/providers — public; the login page uses this to
// decide which buttons to render.
authRoutes.get('/oauth/providers', (c) => {
  return c.json({ data: getEnabledProviders() });
});

// GET /api/v1/auth/oauth/:provider/start
// Generates one-time state + nonce + PKCE verifier, persists in Redis,
// then 302s the browser to the provider's authorization URL.
authRoutes.get('/oauth/:provider/start', async (c) => {
  const provider = c.req.param('provider');
  const returnTo = c.req.query('returnTo') ?? undefined;

  const result = await oauthService.start({ provider, returnTo });
  if ('error' in result) {
    return c.json({ error: { code: result.error, message: 'Provider not configured' } }, 404);
  }
  return c.redirect(result.url, 302);
});

// GET /api/v1/auth/oauth/:provider/callback
// Provider sends the user here after consent. We exchange the code,
// resolve the identity, set the refresh cookie, and 302 to the SPA's
// /oauth/finish page so AuthBootstrap can pick up the new session.
authRoutes.get('/oauth/:provider/callback', async (c) => {
  const provider = c.req.param('provider');
  const code     = c.req.query('code');
  const state    = c.req.query('state');

  // Front-end origin we redirect back to. Falls back to the frontend's
  // dev port when no explicit env var is set.
  const finishBase = (process.env.OAUTH_FINISH_BASE_URL ?? process.env.CORS_ORIGIN ?? 'http://localhost:3000')
    .split(',')[0]!.trim().replace(/\/$/, '');

  if (!code || !state) {
    return c.redirect(`${finishBase}/oauth/error?reason=INVALID_STATE`, 302);
  }

  const result = await oauthService.callback({ provider, code, state });
  const meta   = clientMeta(c);

  if (result.kind === 'error') {
    // Phase 1.D — record the failure too. INVALID_STATE / ACCOUNT_EXISTS
    // are the ones an admin actually wants to see in the audit log when
    // diagnosing a brute-force or a confused user.
    adminService.log({
      userId:     '00000000-0000-0000-0000-000000000000',
      userEmail:  null,
      action:     'oauth.login.failure',
      resource:   'OAuth',
      resourceId: provider,
      newValues:  { reason: result.reason },
      ipAddress:  meta.ip,
      userAgent:  meta.userAgent,
    });
    return c.redirect(`${finishBase}/oauth/error?reason=${result.reason}`, 302);
  }

  const returnTo = encodeURIComponent(result.returnTo ?? '/board');

  // Link flow: the user is already authenticated; we just attached an
  // identity. Skip the cookie rotation and bounce them straight back to
  // settings.
  if (result.kind === 'linked') {
    adminService.log({
      userId:     result.userId,
      userEmail:  null,
      action:     'oauth.link',
      resource:   'OAuth',
      resourceId: provider,
      ipAddress:  meta.ip,
      userAgent:  meta.userAgent,
    });
    return c.redirect(`${finishBase}${decodeURIComponent(returnTo)}`, 302);
  }

  // Phase 1.F — MFA gate. Provider auth alone isn't enough; the user
  // still needs to pass the second factor before we issue a session.
  // Hand the mfa-challenge JWT to the SPA's /oauth/mfa page, which
  // collects the TOTP and POSTs to the existing /auth/mfa/challenge.
  // No refresh cookie set yet — that happens after MFA succeeds.
  if (result.kind === 'mfa-required') {
    adminService.log({
      userId:     result.userId,
      userEmail:  result.userEmail,
      action:     'oauth.mfa-required',
      resource:   'OAuth',
      resourceId: provider,
      ipAddress:  meta.ip,
      userAgent:  meta.userAgent,
    });
    const mfaQs = new URLSearchParams({
      token:    result.mfaToken,
      returnTo: result.returnTo ?? '/board',
    });
    return c.redirect(`${finishBase}/oauth/mfa?${mfaQs.toString()}`, 302);
  }

  setRefreshCookie(c, result.refreshToken);
  adminService.log({
    userId:     (result.user as any).Id ?? (result.user as any).id ?? '',
    userEmail:  (result.user as any).Email ?? (result.user as any).email ?? null,
    action:     'oauth.login',
    resource:   'OAuth',
    resourceId: provider,
    ipAddress:  meta.ip,
    userAgent:  meta.userAgent,
  });
  // The /oauth/finish page calls /auth/refresh on mount to pick up the
  // access token, then routes the user to returnTo. We pass returnTo as
  // a query param rather than baking it into the cookie.
  return c.redirect(`${finishBase}/oauth/finish?returnTo=${returnTo}`, 302);
});

// GET /api/v1/auth/oauth/identities  (protected)
// Returns the providers the current user has linked. Drives the
// "Connected accounts" settings panel.
authRoutes.get('/oauth/identities', authMiddleware, async (c) => {
  const jwtPayload = (c as any).get('user') as any;
  const rows = await oauthService.listIdentitiesForUser(jwtPayload.userId);
  return c.json({
    data: rows.map((r) => ({
      id:        r.Id,
      provider:  r.Provider,
      email:     r.Email,
      createdAt: r.CreatedAt,
    })),
  });
});

// GET /api/v1/auth/oauth/:provider/link  (protected)
// Same redirect-to-provider dance as /start, but stamps the user's id
// into the state payload so the callback links the new identity to
// THIS user instead of creating a new account.
authRoutes.get('/oauth/:provider/link', authMiddleware, async (c) => {
  const provider   = c.req.param('provider')!;
  const returnTo   = c.req.query('returnTo') ?? '/settings/connected-accounts';
  const jwtPayload = (c as any).get('user') as any;

  const result = await oauthService.start({
    provider,
    returnTo,
    linkUserId: jwtPayload.userId,
  });
  if ('error' in result) {
    return c.json({ error: { code: result.error, message: 'Provider not configured' } }, 404);
  }
  return c.redirect(result.url, 302);
});

// DELETE /api/v1/auth/oauth/identities/:provider  (protected)
// Unlink a provider. Returns 409 LAST_CREDENTIAL when removing it would
// leave the user with no password and no other linked provider.
authRoutes.delete('/oauth/identities/:provider', authMiddleware, async (c) => {
  const provider   = c.req.param('provider')!;
  const jwtPayload = (c as any).get('user') as any;

  const result = await oauthService.unlink(jwtPayload.userId, provider);
  if (!result.ok) {
    return c.json({
      error: {
        code:    'LAST_CREDENTIAL',
        message: 'Cannot remove the last credential. Set a password or link another provider first.',
      },
    }, 409);
  }
  const meta = clientMeta(c);
  adminService.log({
    userId:     jwtPayload.userId,
    userEmail:  jwtPayload.email ?? null,
    action:     'oauth.unlink',
    resource:   'OAuth',
    resourceId: provider,
    ipAddress:  meta.ip,
    userAgent:  meta.userAgent,
  });
  return c.body(null, 204);
});

