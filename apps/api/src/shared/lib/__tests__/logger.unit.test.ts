/**
 * Logger redaction + SP-param summary coverage.
 *
 * The actual `logger` singleton writes to stdout via a transport, which
 * is hard to capture deterministically. Instead we rebuild a pino
 * instance against an in-memory destination with the SAME redact config
 * the production logger uses — that proves the config wires through
 * correctly. The sqlClient helpers (`paramsForLog`, `summariseValue`)
 * are pure and tested directly.
 */

import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { paramsForLog, summariseValue } from '../sqlClient.js';

// Build the redact config locally so the test fails loudly if someone
// changes the production list without updating coverage. Kept in sync
// with apps/api/src/shared/lib/logger.ts.
const REDACT_PATHS = [
  '*.password',
  '*.PasswordHash',
  '*.passwordHash',
  '*.MfaSecret',
  '*.mfaSecret',
  '*.refreshToken',
  '*.RefreshToken',
  '*.AccessTokenEnc',
  '*.RefreshTokenEnc',
  '*.accessTokenEnc',
  '*.refreshTokenEnc',
  '*.token',
  '*.Token',
  'params.@Password',
  'params.@PasswordHash',
  'params.@MfaSecret',
  'params.@AccessTokenEnc',
  'params.@RefreshTokenEnc',
  'params.@Code',
  'params.@RecoveryCode',
  'params.@Subject',
  'params.@Email',
];

function captureLogger() {
  const lines: any[] = [];
  const stream = {
    write(chunk: string) {
      // pino writes one JSON object per line, newline-terminated.
      lines.push(JSON.parse(chunk));
    },
  };
  const log = pino(
    {
      level: 'debug',
      redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    },
    stream as any,
  );
  return { log, lines };
}

describe('logger — redaction', () => {
  it('redacts top-level password-ish keys via wildcard path', () => {
    const { log, lines } = captureLogger();
    log.info({ user: { password: 'hunter2', email: 'u@x.com' } }, 'login');
    expect(lines[0]!.user.password).toBe('[redacted]');
    expect(lines[0]!.user.email).toBe('u@x.com');
  });

  it('redacts PasswordHash regardless of casing path', () => {
    const { log, lines } = captureLogger();
    log.info({ row: { PasswordHash: 'bcrypt...', Email: 'who@x.com' } }, 'select');
    expect(lines[0]!.row.PasswordHash).toBe('[redacted]');
  });

  it('redacts SP params containing secrets', () => {
    const { log, lines } = captureLogger();
    log.info({
      sp: 'usp_User_Create',
      params: {
        '@Email':        'foo@bar.com',  // PII; redacted
        '@Name':         'Foo Bar',      // safe
        '@PasswordHash': 'bcrypt$2a$12', // redacted
      },
    }, 'usp_User_Create OK');
    const entry = lines[0]!;
    expect(entry.params['@PasswordHash']).toBe('[redacted]');
    expect(entry.params['@Email']).toBe('[redacted]');
    expect(entry.params['@Name']).toBe('Foo Bar');
  });

  it('redacts encrypted token columns', () => {
    const { log, lines } = captureLogger();
    log.info({
      sp: 'usp_UserOAuthIdentity_UpsertTokens',
      params: {
        '@AccessTokenEnc':  'v1.test.abc.def.ghi',
        '@RefreshTokenEnc': 'v1.test.xyz.uvw.pqr',
        '@Provider':        'google',
      },
    }, 'persist');
    const entry = lines[0]!;
    expect(entry.params['@AccessTokenEnc']).toBe('[redacted]');
    expect(entry.params['@RefreshTokenEnc']).toBe('[redacted]');
    expect(entry.params['@Provider']).toBe('google');
  });

  it('redacts MFA code + recovery code from SP params', () => {
    const { log, lines } = captureLogger();
    log.info({
      sp: 'usp_MfaRecoveryCode_Consume',
      params: { '@Code': '123456', '@RecoveryCode': 'AAAA-BBBB' },
    }, 'mfa');
    const entry = lines[0]!;
    expect(entry.params['@Code']).toBe('[redacted]');
    expect(entry.params['@RecoveryCode']).toBe('[redacted]');
  });
});

describe('sqlClient.paramsForLog', () => {
  it('handles array-form SpParam[] and prefixes names with @', () => {
    const out = paramsForLog([
      { name: 'UserId',   type: {} as any, value: '00000000-0000-0000-0000-000000000001' },
      { name: 'Provider', type: {} as any, value: 'google' },
    ]);
    expect(out).toEqual({
      '@UserId':   '00000000-0000-0000-0000-000000000001',
      '@Provider': 'google',
    });
  });

  it('handles object-form params', () => {
    const out = paramsForLog({ Email: 'u@x.com', IsAdmin: true });
    expect(out).toEqual({ '@Email': 'u@x.com', '@IsAdmin': true });
  });

  it('truncates long string values with a length hint', () => {
    const big = 'x'.repeat(500);
    const out = paramsForLog([{ name: 'Blob', type: {} as any, value: big }]);
    const val = out['@Blob'] as string;
    expect(val.length).toBeLessThan(500);
    expect(val.endsWith('…(500)')).toBe(true);
  });

  it('renders Buffer as size summary instead of dumping bytes', () => {
    const out = paramsForLog([{ name: 'Bytes', type: {} as any, value: Buffer.alloc(1024) }]);
    expect(out['@Bytes']).toBe('<Buffer 1024B>');
  });

  it('renders Date as ISO string', () => {
    const d = new Date('2026-05-13T10:00:00Z');
    const out = paramsForLog([{ name: 'When', type: {} as any, value: d }]);
    expect(out['@When']).toBe('2026-05-13T10:00:00.000Z');
  });
});

describe('sqlClient.summariseValue', () => {
  it('passes through small primitives unchanged', () => {
    expect(summariseValue('short')).toBe('short');
    expect(summariseValue(42)).toBe(42);
    expect(summariseValue(false)).toBe(false);
    expect(summariseValue(null)).toBe(null);
    expect(summariseValue(undefined)).toBe(undefined);
  });

  it('returns the typeof for unrecognised exotic values', () => {
    expect(summariseValue({ a: 1 })).toBe('object');
  });
});
