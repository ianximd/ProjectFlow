/**
 * Structured logger for the API process.
 *
 * Output behaviour:
 *   - dev (NODE_ENV !== 'production'): human-readable lines via pino-pretty,
 *     coloured, with timestamps. Lets you eyeball what's happening when
 *     running `npm run dev`.
 *   - prod:                            raw JSON, one event per line. Suitable
 *     for piping to journald / Loki / Cloudwatch / ELK / whatever ships
 *     stdout off the box.
 *
 * Level override:
 *   - LOG_LEVEL env var: trace | debug | info | warn | error | fatal.
 *   - default: 'info' (prod) / 'debug' (dev). Tests stay quiet by
 *     defaulting to 'warn' unless the suite explicitly raises it.
 *
 * Redaction:
 *   The `redactPaths` list below is applied to every log call. Adding a
 *   new sensitive field — e.g. you start logging an OAuth row — means
 *   adding its key here, NOT cleaning the call site. Defence in depth.
 */

import pino from 'pino';

const isProd = process.env.NODE_ENV === 'production';
const isTest = process.env.NODE_ENV === 'test';

// Tests intentionally quiet — they exercise 4xx paths constantly and we
// don't want hundreds of warn lines per run. LOG_LEVEL=debug under
// vitest opts back into the full firehose if you're debugging.
const defaultLevel = isTest ? 'silent' : (isProd ? 'info' : 'debug');
const level = process.env.LOG_LEVEL ?? defaultLevel;

// Redact at any depth. Pino walks the object once and replaces matching
// leaves with '[redacted]'. Hits are extension-friendly: see
// https://github.com/pinojs/pino/blob/main/docs/redaction.md
const redactPaths = [
  // password/secret-shaped fields, regardless of nesting
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
  // SP param shape used by execSp logging
  'params.@Password',
  'params.@PasswordHash',
  'params.@MfaSecret',
  'params.@AccessTokenEnc',
  'params.@RefreshTokenEnc',
  'params.@Code',          // MFA code or password-reset code
  'params.@RecoveryCode',
  'params.@Subject',       // OAuth provider subject — PII-adjacent
  'params.@Email',         // PII — keep redacted from SP logs; HTTP logs already include it intentionally
];

export const logger = pino({
  level,
  base:        { pid: process.pid },
  timestamp:   pino.stdTimeFunctions.isoTime,
  redact:      { paths: redactPaths, censor: '[redacted]' },
  // pino-pretty only in non-prod. In prod (and tests) we emit JSON
  // directly — log shippers + the test capture buffer both prefer it.
  transport:   (!isProd && !isTest) ? {
    target:  'pino-pretty',
    options: {
      colorize:        true,
      translateTime:   'HH:MM:ss.l',
      ignore:          'pid,hostname',
      singleLine:      false,
      // Show requestId + spName prominently when present
      messageFormat:   '{msg} {req} {sp}',
    },
  } : undefined,
});

/**
 * Tag a logger with a fixed namespace so its lines stand out in a flood
 * of unrelated events. Usage:
 *   const log = subLogger('oauth-maintenance');
 *   log.info({ scanned: 12 }, 'rotation sweep');
 *
 * The namespace shows up as `name=<value>` in JSON output and is included
 * in the pretty terminal line via pino's default formatter.
 */
export function subLogger(name: string) {
  return logger.child({ name });
}
