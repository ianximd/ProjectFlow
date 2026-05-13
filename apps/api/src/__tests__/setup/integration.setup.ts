/**
 * Per-file setup loaded BEFORE the test file's imports. The env vars set
 * here must be in place before `db.ts`'s module-level `config` literal
 * evaluates, otherwise the pool will connect to the dev `ProjectFlow`
 * database instead of `ProjectFlow_Test`. Vitest preloads `setupFiles`
 * before any other module in the worker, so this is the right hook.
 */

process.env.NODE_ENV   = 'test';
process.env.DB_NAME    = 'ProjectFlow_Test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-secret-32-chars!!';
// Keep the response-cache layer real (Redis), but use a separate key
// namespace so dev cache and test cache don't collide.
process.env.REDIS_URL  = process.env.REDIS_URL || 'redis://localhost:6379';
// Enable the test-only OAuth provider (`fake`) so OAuth integration
// tests can exercise the callback path without hitting real Google /
// GitHub / Microsoft endpoints. Only honoured when NODE_ENV === 'test'.
process.env.OAUTH_TEST_PROVIDER = 'true';
