import { Hono } from 'hono';
import { setCookie, getCookie, deleteCookie } from 'hono/cookie';
import { AuthRepository } from './auth.repository.js';
import { AuthService } from './auth.service.js';
import { authMiddleware } from './auth.middleware.js';
import { roleService } from '../roles/role.service.js';

const authRepo = new AuthRepository();
const authService = new AuthService(authRepo);

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

  // Refresh token is delivered via httpOnly cookie — never exposed in the response body
  setRefreshCookie(c, result.refreshToken);
  return c.json({ data: { user: result.user, token: result.accessToken } });
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
  return c.json({ data: { user: result.user, token: result.accessToken } });
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
  return c.json({ data: { token: result.accessToken } });
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

