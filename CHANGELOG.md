# Changelog

All notable changes to ProjectFlow are documented here.  
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).  
Versioning follows [Semantic Versioning](https://semver.org/).

---

## [Unreleased] — Phase 5 + Phase 6

### Added

#### Phase 6 — Post-launch (Week 42 — OAuth × MFA: close the second-factor bypass)

**Security fix.** Until Phase 1.F, the OAuth callback handler called `AuthService.issueSessionTokens(user)` directly without checking `Users.MfaEnabled`. The same user signing in with their password would be challenged for TOTP; signing in via Google/Microsoft would not. An attacker who compromised a user's social account got an MFA-protected ProjectFlow session for free. This phase closes that gap.

- **`AuthService.mintMfaChallengeToken(userId, email)`** — extracted from the existing `login()` method so OAuth can mint the *exact same* short-lived `purpose: 'mfa-challenge'` JWT shape password+MFA login uses. Single helper means the two callsites can't drift in their TTL or claim shape
- **`OAuthCallbackResult`** gains a fourth variant: `{ kind: 'mfa-required'; userId; userEmail; mfaToken }`. The other three (`tokens`, `linked`, `error`) are unchanged
- **`OAuthService.maybeMfaGate()`** — private helper invoked at the two sign-in branches where a pre-existing user gets resolved:
  - **Existing-identity sign-in**: `findByProviderSubject → getUserById → MfaEnabled?` — gate fires, `issueSessionTokens` does NOT
  - **Email-collision auto-link**: identity is still attached to the local user, then the gate fires before token issuance — provider auth proved the social account, but the local account's MFA still gates the session
  - **Brand-new-user-via-OAuth**: deliberately skips the gate — just-created users can't have MFA enabled. Skipping the call also avoids the JWT mint cost on the hot path
  - Accepts both `MfaEnabled === true` (booleans) and `=== 1` (SQL bit driver shape)
- **Token persistence policy at the gate**: encrypted provider tokens ARE written to `UserOAuthIdentities` even when MFA hasn't completed. Trade-off documented in the service comment: an attacker who passes provider auth but fails MFA leaves a few KB of ciphertext sitting in our DB — they cannot get a session regardless, and the legitimate user benefits when they complete the challenge because the refresh + rotation workers can already see the row. The cost-of-failure asymmetry is heavily in favour of persisting eagerly
- **Route handler** (`auth.routes.ts`) gains the mfa-required branch: 302 to `${finishBase}/oauth/mfa?token=<mfa-jwt>&returnTo=<spa-path>`, deliberately WITHOUT calling `setRefreshCookie` (no session yet). The frontend's `/oauth/mfa` page collects the TOTP and POSTs to the existing `/auth/mfa/challenge` endpoint, which sets the refresh cookie on success — no second MFA endpoint needed, both password and OAuth paths converge there
- **New frontend page** `apps/next-web/src/app/oauth/mfa/page.tsx` — Suspense-wrapped client component, reads `token` + `returnTo` from query, supports TOTP and recovery-code modes via a single input field with a "use a recovery code instead" toggle. On success calls `/auth/refresh` to pick up the access token (mirroring the `/oauth/finish` pattern from Phase 1.A) and SPA-navigates to `returnTo`. Stale-link defence: bails to `/login` if `token` is missing (5-min challenge JWT expired or page bookmarked)
- **Audit log** gains `oauth.mfa-required` events:
  - Fired when the gate redirects to `/oauth/mfa` — records userId + userEmail so an admin investigating a half-completed sign-in can see who got challenged
  - `oauth.login` event no longer fires for MFA-gated flows — it only fires when tokens are actually issued, which means a user who challenge-fails appears in audit as `oauth.mfa-required` but never as `oauth.login`. The other half-step's audit (the `/auth/mfa/challenge` POST) is a pre-existing gap for password+MFA too; that's tracked separately
- **8 new tests** (172 total in API now, +8 over W41's 164):
  - 6 unit tests in `oauth.service.unit.test.ts` for the gate: fires for existing-identity with `MfaEnabled=true`, fires for auto-link branch (identity still linked, no session issued), does NOT fire for brand-new user, does NOT fire when `MfaEnabled=false`, persists tokens at the gate boundary (proves the documented trade-off), accepts `MfaEnabled=1` SQL-bit shape the same as `=true`. All assert `authService.issueSessionTokens` was NOT called when the gate fires — that's the bypass the unit suite is guarding against
  - 2 integration tests in `oauth.callback.integration.test.ts`:
    - Real MFA-enabled user signs in via OAuth → callback 302s to `/oauth/mfa?token=…&returnTo=/board` with a 3-part JWT in the query, sets NO `Set-Cookie` (no refresh token issued), and writes a `oauth.mfa-required` row to `dbo.AuditLog`
    - Second sign-in for an MFA-enabled user does not add a second `oauth.login` row — the first sign-in (before MFA was turned on) accounts for the only `oauth.login` row; the second produces `oauth.mfa-required` instead

**Limitations**: the deferred-persistence trade-off above. Also, the new `/oauth/mfa` page calls `/auth/refresh` after a successful challenge to pick up the access token — same single-cookie-then-refresh hop the rest of the auth flows use, but worth noting that an OAuth+MFA sign-in is now a 4-redirect dance: provider → `/api/v1/auth/oauth/:p/callback` → SPA `/oauth/mfa` → `/auth/mfa/challenge` POST → SPA returnTo.

#### Phase 6 — Post-launch (Week 41 — OAuth maintenance workers: silent-refresh + key-rotation)
- **`apps/api/src/modules/auth/oauth/workers/oauth-maintenance.worker.ts`** — single BullMQ queue (`oauth-maintenance`) drives two recurring jobs via `JobScheduler.upsertJobScheduler` (BullMQ ≥5 idempotent recurring API). Refresh sweep every 5 minutes, rotation sweep every 15 minutes. Both gated on `tokenCrypto.isConfigured()` — the worker exits cleanly without scheduling anything when the OSS deployment hasn't set `OAUTH_TOKEN_ENC_KEY_PRIMARY`. Concurrency 1 (both sweeps touch the same table; serialise to dodge contention)
- **Silent-refresh sweep** (`refreshTokens.service.ts`):
  - `runRefreshSweep({ withinSeconds, limit })` pulls rows whose `TokenExpiresAt <= now + within` AND `RefreshTokenEnc IS NOT NULL`, decrypts the refresh token via `tokenCrypto.open()`, calls `provider.refreshTokens()`, re-seals the new pair, persists via `usp_UserOAuthIdentity_UpsertTokens`. Returns `{ scanned, refreshed, skippedNoRefresh, failed }` so the worker can log volumetrics
  - **Per-row failures don't abort the sweep** — provider revocation, expired refresh, network blip, or a row whose KeyVersion got dropped from env all increment `failed` and the loop keeps going. One bad identity can't poison the rest of the batch
  - Skips providers whose abstraction doesn't implement `refreshTokens`. Google + Microsoft do (added in this phase); GitHub OAuth Apps don't issue refresh tokens at all (their access tokens don't expire); the test-only fake provider does (deterministic + with a `'refresh-fail'` sentinel)
- **Key-rotation sweep** (`keyRotation.service.ts`):
  - `runRotationSweep({ limit })` reads `tokenCrypto.describeKeyset()` for the current PRIMARY, batches `usp_UserOAuthIdentity_ListByKeyVersion(@PrimaryKeyVersion, @Limit)`, decrypts each row under its old key id, re-seals under PRIMARY, writes back. Returns `{ primary, scanned, rotated, failed, remaining }` — `remaining: 'maybe-more'` when the batch fills the limit (more rows likely waiting), `'caught-up'` when fewer
  - Stable Id ordering on the SP so a worker restart mid-sweep just re-reads from the next row, no skipping or duplication
  - **Race-safe**: if a row's KeyVersion already matches PRIMARY by the time we get to it (someone else rotated it between SELECT and pickup), the worker counts it as `rotated` without doing the write. Decrypt failures (typically a missing key in env) are logged and counted, sweep continues
- **Provider abstraction extension** — added optional `refreshTokens(refreshToken: string)` to `OAuthProvider`. Google: standard OAuth `grant_type=refresh_token` POST; refresh_token usually omitted from the response (the old one stays valid) — the SP layer's `COALESCE(@RefreshTokenEnc, RefreshTokenEnc)` preserves the existing column. Microsoft: same shape, but MS rotates the refresh on every call (we store the new one). Fake provider: deterministic `accessToken: 'refreshed-${rt}', refreshToken: '${rt}-rotated'` with a `'refresh-fail'` sentinel for the failure path
- **2 new SPs** (170 total deployed):
  - `usp_UserOAuthIdentity_ListExpiringTokens(@WithinSeconds, @Limit)` — picks `WHERE RefreshTokenEnc IS NOT NULL AND TokenExpiresAt <= DATEADD(SECOND, @WithinSeconds, SYSUTCDATETIME())`. Excludes NULL `TokenExpiresAt` rows (no way to decide when they expire). Ordered ASC so the most-overdue go first
  - `usp_UserOAuthIdentity_ListByKeyVersion(@PrimaryKeyVersion, @Limit)` — picks `WHERE TokenKeyVersion IS NOT NULL AND TokenKeyVersion <> @PrimaryKeyVersion`. Uses the filtered index from migration 0026 (`WHERE TokenKeyVersion IS NOT NULL`) so the lookup is cheap regardless of the NULL majority
- `server.ts` boot path calls `startOAuthMaintenanceWorker()` after the existing webhook + automation workers; gated on `NODE_ENV !== 'test'` like the others; failures are logged but don't crash the API
- **Runbook updated** (`docs/runbooks/oauth-key-rotation.md`): step 3 of the rotation procedure changed from "do this manually with SQL" to "watch the worker drain the backlog"; new "silent refresh" section explains what the second sweep does (and why it's mostly a no-op for the current sign-in-only OAuth scope — Google needs `access_type=offline` opt-in, GitHub doesn't refresh)
- **18 new tests** (164 total in API now, +18 over W40's 146):
  - 8 unit tests in `refreshTokens.service.unit.test.ts`: skips when crypto unconfigured, zeros when SP returns nothing, end-to-end refresh + persist, NULL-refresh-token preservation through `COALESCE`, provider-without-refresh counted as `skippedNoRefresh`, provider error counted as `failed` without aborting, options threaded through to SP
  - 6 unit tests in `keyRotation.service.unit.test.ts`: caught-up when crypto unconfigured / no PRIMARY, end-to-end re-encrypt, NULL access/refresh preserved, `maybe-more` signalled when batch fills limit, race-case (already-on-PRIMARY) counted without write, decrypt failure counted without aborting
  - 4 integration tests in `oauth-maintenance.integration.test.ts` against the real DB: refresh sweep mutates a past-expiry row's ciphertext and `TokenExpiresAt`, refresh sweep ignores comfortably-future rows, rotation sweep re-encrypts a row stamped with a non-PRIMARY key id (uses an env-flip + `_resetForTest` trick to seal under a synthetic legacy key), rotation reports `caught-up` with `scanned=0` when the table has no off-PRIMARY rows

#### Phase 6 — Post-launch (Week 40 — OAuth hardening: at-rest token encryption + audit log)
- **`apps/api/src/shared/lib/tokenCrypto.ts`** — AES-256-GCM seal/open for OAuth provider tokens. 96-bit random IV per record (NIST SP 800-38D §8.2.1 RBG-based), 128-bit auth tag. Sealed format `v1.<keyId>.<iv>.<tag>.<ct>` (all base64url after the version prefix) — the key id is **embedded in the row, not stored separately**, so old rows stay decryptable after a new primary key is introduced. Module is configured via env (`OAUTH_TOKEN_ENC_KEY_PRIMARY=v1`, `OAUTH_TOKEN_ENC_KEY_v1=<base64-32B>`); when `_PRIMARY` is unset, `isConfigured()` returns false and the OAuth service silently skips persistence. Same opt-in stance as Google/GitHub/Microsoft env vars
- **Migration 0026** — adds `UserOAuthIdentities.TokenKeyVersion NVARCHAR(16) NULL` with a filtered index `WHERE TokenKeyVersion IS NOT NULL` so the rotation worker can do `WHERE TokenKeyVersion <> @Primary` cheaply without the index bloating from the NULL majority. Existing 0025 reserved `AccessTokenEnc`/`RefreshTokenEnc`/`TokenExpiresAt` columns; this completes the schema
- New stored procs (now 168 total):
  - `usp_UserOAuthIdentity_UpsertTokens(Provider, Subject, AccessTokenEnc, RefreshTokenEnc, TokenExpiresAt, TokenKeyVersion)` — identified by the natural unique key the OAuth callback already has. **Refresh-token NULL is preserved on the row** rather than overwriting — providers (notably Google) only return the refresh token on first authorization, so subsequent silent refreshes mustn't blank it out. Returns `RowsAffected` so the service can distinguish "never linked this identity" from "linked but no row to update"
  - `usp_UserOAuthIdentity_GetTokens(UserId, Provider)` — fetches both ciphertexts + `TokenKeyVersion` for the future silent-refresh worker and the (not-yet-built) rotation worker
- `OAuthService.callback` now persists encrypted access + refresh tokens after **every** successful path: existing-identity sign-in, new-user creation, `/link` flow, and the email-collision auto-link branch. Persistence failure does NOT block the user's session — `persistEncryptedTokens` is wrapped in try/catch so a storage hiccup on the refresh-token column doesn't take down sign-in. The caller still gets their tokens; an admin gets a log line
- **Audit log entries** for OAuth events — surfaced through `adminService.log()` (fire-and-forget, same path the existing audit middleware uses, but invoked directly from the route handler since callbacks arrive as GETs and the middleware only fires on POST/PATCH/PUT/DELETE):
  - `oauth.login` — successful sign-in (existing identity, new user, OR auto-link); records user id + email + provider
  - `oauth.link` — explicit link via `/oauth/:provider/link`; records the link-flow user id
  - `oauth.unlink` — disconnection via `DELETE /oauth/identities/:provider`; records the unlinker's identity
  - `oauth.login.failure` — when the callback rejects with INVALID_STATE / ACCOUNT_EXISTS / PROVIDER_ERROR / NO_EMAIL / ALREADY_LINKED. UserId is a zero-UUID since we don't know who tried (the failure is what's interesting for brute-force / replay forensics)
- **`docs/runbooks/oauth-key-rotation.md`** — operational doc. Setup procedure, when-to-rotate guidance, three-step zero-downtime rotation (add new key → flip PRIMARY → re-encrypt backlog → drop old key), and incident scenarios (leaked key, accidentally dropped before re-encrypt, malformed key material). Plus the env-var reference table
- `apps/api/.env.example` gains the `OAUTH_TOKEN_ENC_KEY_PRIMARY` + `OAUTH_TOKEN_ENC_KEY_v1` block with a one-liner pointer at the runbook
- **21 new tests** (146 total in API now, +21 over W39's 125):
  - 12 unit tests in `tokenCrypto.unit.test.ts`: configuration (no PRIMARY → unconfigured, PRIMARY to absent key → throws, bad key-id chars → throws, wrong key length → throws), roundtrip (typical token, empty string, non-deterministic IVs), key rotation (decrypt v1-sealed after PRIMARY flipped to v2, refuse decrypt when encrypting key removed), tamper detection (ciphertext byte flip → auth tag fails, wrong segment count, unknown format version)
  - 5 service unit tests covering persistence wiring: persists access + refresh after new-user sign-in, persists access-only when provider returns no refresh, persists after the link flow, skips entirely when `isConfigured() === false`, swallows persistence errors so sign-in still succeeds
  - 4 integration tests in `oauth.callback.integration.test.ts`: `AccessTokenEnc` populated with `v1.test.…` sealed string + `TokenKeyVersion='test'` after a fake-provider login; `oauth.login` / `oauth.link` / `oauth.unlink` rows actually appear in `dbo.AuditLog` (polled, since the log is fire-and-forget). Integration setup turns on a deterministic 32-zero-byte key so all OAuth integration tests get end-to-end persistence coverage for free

#### Phase 6 — Post-launch (Week 39 — OAuth: linking, identities, unlink, email-collision auto-link)
- `OAuthService.start({ linkUserId })` — when called from an authenticated user's link flow, the user id is stamped into the Redis state payload. The callback then attaches the new identity to that user instead of creating one
- `OAuthService.callback` gains a third return shape `{ kind: 'linked', userId }` (no session tokens issued — the user is already signed in). The route bounces them straight back to settings instead of going through `/oauth/finish`
- **Email-collision auto-link**: when an anonymous OAuth callback's email matches an existing local account, AND both the provider asserts `emailVerified` AND the local account has `IsEmailVerified = 1`, the new identity is attached to the existing user and tokens are issued. Both sides have proven email ownership; no additional challenge required. When either side is unverified, the call still rejects with `ACCOUNT_EXISTS` so the user must sign in with their password and link from settings
- New REST endpoints (all auth-required except where noted):
  - `GET /api/v1/auth/oauth/identities` — returns the user's linked providers (drives Connected accounts UI)
  - `GET /api/v1/auth/oauth/:provider/link?returnTo=` — same redirect-to-provider dance as `/start` but stamps the user id into state. Returns 404 when the provider is not configured, 401 without a session
  - `DELETE /api/v1/auth/oauth/identities/:provider` — unlinks. Returns 409 with `error.code = 'LAST_CREDENTIAL'` when removing this would leave the user with no password and no other linked provider — the SP guard from migration 0025 (`THROW 51031`) is mapped through the service layer. Returns 204 on success
- Race protection: even the auto-link branch checks for SP error 51030 (provider+subject already linked to a *different* user) and surfaces it as `ALREADY_LINKED`. Catches the case where two users race to claim the same identity in the gap between `findByProviderSubject` and `linkExisting`
- New frontend page `apps/next-web/src/app/(app)/settings/connected-accounts/page.tsx` — lists linked providers with Disconnect buttons (+ inline last-credential warning for OAuth-only users) and unlinked-but-configured providers with Connect buttons that drive `/api/v1/auth/oauth/:provider/link`. Built around the same `useStore` access-token pattern as the rest of the app shell
- 9 new unit tests in `oauth.service.unit.test.ts`:
  - Auto-link happy path (both verified) — issues tokens for the LOCAL user, never calls `createUserWithIdentity`
  - Auto-link refuses when provider says unverified
  - Auto-link race → `ALREADY_LINKED`
  - Link flow happy path (`{ kind: 'linked', userId, returnTo }`, no session-token issuance)
  - Link flow `ALREADY_LINKED` propagation
  - Idempotent re-link
  - `unlink()` ok / `LAST_CREDENTIAL` typed result / unexpected errors rethrow
- 8 new integration tests in `oauth.callback.integration.test.ts`:
  - Local-user-then-link via `/link` → callback → identity actually appears in `/identities`
  - `/link` 401 without a session
  - Cross-user `ALREADY_LINKED` race against a previously OAuth-created user
  - `/identities` 401 without session, returns `[]` for fresh user
  - OAuth-only user is blocked from removing their last identity (409 `LAST_CREDENTIAL`)
  - Password user can disconnect their linked identity (204 + `/identities` empties)
  - Auto-link branch: pre-verified local user signs in via OAuth (anon flow) and gets attached to the existing user (no duplicate Users row created)

#### Phase 6 — Post-launch (Week 38 — OAuth: GitHub + Microsoft providers)
- **`providers/microsoft.ts`** — Microsoft Identity Platform v2.0 with PKCE on every flow (Microsoft requires it for confidential web clients too). Tenant defaults to `common` so any work/school/personal account can sign in; `MICROSOFT_OAUTH_TENANT` env var locks to a specific GUID for enterprise SSO. **`subject` is Graph `/me.id` (the directory `oid`), NOT the OIDC `sub` claim** — `sub` is tenant-scoped on `common`, so the same human gets a different `sub` from work vs personal accounts. Email falls back from `mail` (real mailbox) to `userPrincipalName` (sign-in identifier; populated for personal MSA accounts that have no provisioned mailbox). `prompt=select_account` so multi-account users get the picker
- **`providers/github.ts`** — GitHub OAuth Apps. **PKCE deliberately omitted** — GitHub OAuth Apps don't support it (the authorization endpoint silently ignores `code_challenge`); sending dead params would mask bugs in real-provider testing. Confidential-client flow with `client_secret` is still safe. **Email fallback**: when `/user.email` is null (user set their primary as private), call `/user/emails` with the `user:email` scope and pick the primary verified address; if no verified email exists, surface `NO_EMAIL` upstream so the user is sent to `/oauth/error?reason=NO_EMAIL`. `subject` is the numeric GitHub user `id` stringified (stable across renames). Uses `Accept: application/json` on the token exchange to avoid parsing GitHub's default form-encoded response. Handles GitHub's quirk of returning 200 with `{ error: 'bad_verification_code' }` on bad codes
- Registry env-gates both: a deployment with no `GITHUB_*` vars (or no `MICROSOFT_*` vars) simply hides those providers — the server still boots, `/auth/oauth/providers` returns whichever providers are configured, and the `/start` endpoint for an unconfigured provider returns 404
- Login page (`apps/next-web/src/app/login/page.tsx`) `PROVIDER_META` map gains `github` and `microsoft` rows — buttons render automatically when the registry exposes them
- New env vars in `apps/api/.env.example` with inline portal-setup instructions: `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET`, `MICROSOFT_OAUTH_CLIENT_ID`, `MICROSOFT_OAUTH_CLIENT_SECRET`, `MICROSOFT_OAUTH_TENANT` (defaults to `common`). Microsoft setup notes call out the `oid`-not-`sub` decision so a future maintainer doesn't "fix" it
- 17 new unit tests for the two providers, all written with `vi.stubGlobal('fetch', …)` so they never hit real provider endpoints:
  - `microsoft.provider.unit.test.ts` (6 tests) — PKCE S256 in authz URL, custom tenant in path, **`oid` chosen over `sub` when Graph response includes both with deliberately divergent values** (proves the stability rule in code), `userPrincipalName` fallback for MSA accounts, null-email path, 401 propagates as throw
  - `github.provider.unit.test.ts` (11 tests) — PKCE NOT in authz URL (and verifier doesn't leak), `user:email` scope requested, `/user.email` happy path, `/user/emails` fallback picks primary verified, picks first-verified when no primary verified, returns null when no verified addresses, returns null when `/user/emails` 403s (revoked scope), `name` falls back to `login`, `Accept: application/json` on token exchange, GitHub's 200-with-error quirk surfaces as throw

#### Phase 6 — Post-launch (Week 37 — OAuth foundation: Google sign-in)
- **Migration `0025_oauth_identities.sql`** — adds `dbo.UserOAuthIdentities` (`Id, UserId, Provider, Subject, Email, AccessTokenEnc, RefreshTokenEnc, TokenExpiresAt, CreatedAt, UpdatedAt`) with `UNIQUE (Provider, Subject)` and an index on `UserId`. Satellite-table pattern (mirrors `MfaRecoveryCodes`) so a user can link multiple providers without sparse columns. Token columns reserved for Phase 1.D / future Drive-style features; v1 is pure-identity. `ON DELETE CASCADE` on `UserId` so user deletion cleanly removes linked identities. Idempotent
- 5 new stored procedures:
  - `usp_UserOAuthIdentity_GetByProviderSubject` — primary lookup during callback
  - `usp_UserOAuthIdentity_LinkExisting` — attaches a provider/subject to an existing user; throws 51030 if already linked to a different account
  - `usp_UserOAuthIdentity_Unlink` — refuses (51031) when removing the user's last credential to prevent lockout
  - `usp_UserOAuthIdentity_ListForUser` — drives the future "Connected accounts" panel
  - `usp_User_CreateFromOAuth` — atomic Users + UserOAuthIdentities insert in a transaction. `PasswordHash NULL`, `IsEmailVerified` follows the provider's assertion
- **Provider abstraction** in `apps/api/src/modules/auth/oauth/`:
  - `types.ts` — small `OAuthProvider` interface (`getAuthorizationUrl` / `exchangeCode` / `fetchUserInfo`). Adding a 4th provider in 1.B/later is one new file plus one entry in the registry
  - `providers/google.ts` — Google OIDC, `prompt=select_account`, **PKCE on every flow** (cost nothing, protects the redirect leg even on confidential clients). 5 s timeout per outbound request
  - `providers/fake.ts` — test-only provider registered only when `NODE_ENV === 'test'` AND `OAUTH_TEST_PROVIDER === 'true'`. Lets integration tests drive the full callback path with deterministic identities; never reachable from production
  - `registry.ts` — env-gated. A provider is enabled only when both its `*_CLIENT_ID` and `*_CLIENT_SECRET` are set, so a deployment with no OAuth creds boots cleanly and `/auth/oauth/providers` simply returns `[]`
  - `state.ts` — Redis-backed one-time state store with 10-min TTL. State token consumed via DEL-on-read; carries provider, nonce, PKCE verifier, and the validated `returnTo` path
  - `service.ts` — orchestrator. Resolves identity (existing → reuse; unseen + fresh email → create user via `usp_User_CreateFromOAuth`; unseen + email collision → `ACCOUNT_EXISTS`). Always issues session tokens through the **existing** `AuthService.issueSessionTokens` so `clearLoginAttempts` + `createRefreshToken` fire identically across password / MFA / OAuth login
  - `repository.ts` — wraps the 5 SPs
- New REST endpoints under `/api/v1/auth/oauth`:
  - `GET /providers` — public; returns the env-enabled provider list. Login page hides the social section when this returns `[]`
  - `GET /:provider/start?returnTo=` — generates state + nonce + PKCE verifier, persists in Redis, 302s to the provider's authorization URL. Returns 404 when the provider is not configured
  - `GET /:provider/callback?code=&state=` — exchanges the code, fetches userinfo, resolves the identity, sets the `refresh_token` cookie, then 302s to the SPA's `/oauth/finish` page. Errors 302 to `/oauth/error?reason=…`
- `AuthService.issueSessionTokens` made public so `OAuthService.callback` can reuse the exact same token-issuance code-path as password + MFA login
- Frontend additions:
  - **Login page** (`apps/next-web/src/app/login/page.tsx`) fetches `/auth/oauth/providers` on mount and renders a `Continue with <provider>` button per enabled provider, above the email/password form, with an "or" divider. Top-level `<a href>` (not fetch) so the browser follows the 302 chain to the consent screen
  - **`/oauth/finish`** — landing page for the post-callback hop. Trades the refresh cookie for an in-memory access token via `/auth/refresh`, populates the Zustand store, then `router.replace(returnTo)`. Mirrors `AuthBootstrap`'s silent-refresh path but lives outside the `(app)` layout so the user sees a brief "Signing you in…" screen
  - **`/oauth/error`** — surfaces `?reason=INVALID_STATE|PROVIDER_ERROR|NO_EMAIL|ACCOUNT_EXISTS` with copy explaining the next step
- New env vars in `apps/api/.env.example` with inline Google Cloud Console setup instructions: `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `OAUTH_REDIRECT_BASE_URL`, `OAUTH_FINISH_BASE_URL`. All optional — empty values disable OAuth without affecting the rest of the API
- **Security details** baked in: PKCE on every flow; state + nonce are one-time (DEL-on-read); `returnTo` validated against a relative-path allow-list to prevent open-redirect; subject-keyed identity lookup, never email-keyed (except the documented future auto-link path)
- 12 unit tests + 8 integration tests for the OAuth surface (FakeProvider stand-in — never hits real Google):
  - `oauth.service.unit.test.ts` covers every branch: existing identity → tokens, new identity + new email → user created, email collision → `ACCOUNT_EXISTS`, no email → `NO_EMAIL`, exchange throws → `PROVIDER_ERROR`, missing/expired state → `INVALID_STATE`, state.provider mismatch → `INVALID_STATE`, unknown provider → `INVALID_STATE`, linked user gone → `INVALID_STATE`, open-redirect-style `returnTo` → coerced to `/board`
  - `oauth.callback.integration.test.ts` proves the full HTTP round-trip against real Redis + SQL: new-subject path persists Users + UserOAuthIdentities rows, repeat sign-in reuses the same user, replay of the same `state` returns 302 → `/oauth/error?reason=INVALID_STATE`, missing code/state, unconfigured provider 404, `/providers` lists the fake provider when `OAUTH_TEST_PROVIDER=true`

#### Phase 6 — Post-launch (Week 36 — Playwright E2E skeleton)
- **One Playwright E2E spec, ~4 s wall-clock**, exercising the highest-value happy path: register (via API) → login (UI) → create workspace via dialog → create project via dialog → cleanup soft-delete via API. Drag-and-drop and task creation deliberately deferred to a later iteration — `@dnd-kit` needs synthetic mouse events that are notoriously flaky in Playwright; better to ship a stable skeleton than a flaky comprehensive flow
- `playwright.config.ts` — single chromium project, serial workers, `webServer` auto-starts both `apps/api` and `apps/next-web` (with `reuseExistingServer: !CI` so a developer with `npm run dev` already running skips the cold boot). Trace + screenshot retained on failure
- `e2e/global-setup.ts` — wipes Redis `rl:*` keys before every run so the auth rate-limiter (10 req / 15 min in dev mode) doesn't 429 the test's own register/login calls after multiple iterations
- `e2e/smoke.spec.ts` uses **SPA navigation (link clicks) instead of `page.goto`** to traverse from `/board` → `/workspaces` → `/projects`. The in-memory access token in Zustand is intentionally not persisted to localStorage (XSS hardening), so a hard reload would force `AuthBootstrap` to silent-refresh via `/auth/refresh` + the httpOnly cookie — that path turned out flaky in dev (cookie forwarding through Next.js rewrites). SPA-internal nav keeps the token alive
- New `.github/workflows/e2e-nightly.yml` — runs once a day (03:00 UTC = 10:00 WIB) plus on-demand via `workflow_dispatch`. Brings up SQL Server + Redis services, runs migrations + SP deploys, installs `--with-deps chromium`, then `npm run test:e2e`. Uploads the Playwright HTML report as an artifact on failure
- `npm run test:e2e` (root) runs the suite; `test:e2e:headed` and `test:e2e:ui` for local debugging
- `.gitignore` updated for `playwright-report/`, `test-results/`, `.playwright/`

#### Phase 6 — Post-launch (Week 35 — Integration test spine)
- **31 integration tests** across 5 files run against a real SQL Server + Redis stack via Vitest's `integration` project. Total wall-clock: ~30 s after the one-time SP deploy. All exercise the route boundary in-process via Hono's `app.request()` — no HTTP listener, no supertest dependency
- `apps/api/src/__tests__/setup/globalSetup.ts` — runs once per `vitest run`. Creates `ProjectFlow_Test` if missing, then re-uses the existing `scripts/db-migrate.ts` and `scripts/db-deploy-sps.ts` as child processes so the schema/SP code-path is identical to production deploys. Test DB is preserved between runs to skip the ~5 s SP deploy on local fast-iteration
- `apps/api/src/__tests__/setup/integration.setup.ts` — preloaded into every worker before module import so `db.ts`'s module-level config evaluates with `DB_NAME=ProjectFlow_Test` and `NODE_ENV=test`
- `apps/api/src/__tests__/setup/testServer.ts` — exports `request(path, init)` that wraps `app.request()` and a `json(res, status?)` parser. Auth via the `token` shorthand sets `Authorization: Bearer …`
- `truncateAll()` now real (`fixtures/truncate.ts`) — clears every mutable table in FK-safe child→parent order while preserving the seed catalog (`Permissions`, `Roles`, `RolePermissions`). Wiping the catalog would silently strip `workspace-owner` of `workspace.delete` so freshly-created workspaces would 403 their own owners
- Test factories (`fixtures/factories.ts`) call the in-process API for `createTestUser` / `createTestWorkspace` / `createTestProject` / `createTestTask`, with a side door (`grantSystemRole`) that goes straight to `usp_UserRole_AssignBySlug` for super-admin — the public API can't promote when no super-admin exists yet
- The 5 integration test files cover the highest-risk paths:
  - `auth.routes.integration.test.ts` (12 tests) — full HTTP round-trip register / login / refresh / logout, refresh-token rotation, replay rejection (cookie cleared on revoked-token replay), 401 on no/bad token
  - `account-lockout.integration.test.ts` (3 tests) — 5 failed logins → lockout (correct password also rejected after lock), successful login clears `FailedLoginCount` + `LockedUntil`, expired `LockedUntil` is treated as not-locked (clock controlled via direct DB stamp)
  - `workspace-delete.integration.test.ts` (5 tests) — closes the v1.0.0 vuln test-shaped: owner can soft-delete + row disappears from list, member with no `workspace.delete` is 403'd, non-member 403/404, super-admin (system scope) overrides workspace gate, double-delete is idempotent (404)
  - `task-transition.integration.test.ts` (5 tests) — happy-path transition with no workflow attached (free movement), 404 on unknown task, 401 unauth, 403 for workspace-viewer (no `task.transition`), DB-level persistence check
  - `cache-invalidation.integration.test.ts` (6 tests) — regression coverage for `bbd9228` and `9c0215c`. Asserts the `x-cache: HIT|MISS` header transitions correctly across POST/PATCH/DELETE on tasks (epics) + workspace + project writes. Caught a real bug along the way: the cache busts were fire-and-forget, so a read-after-write within the same client could race and HIT-read stale data. Now awaited

### Fixed

- Response cache invalidation in `task.routes.ts`, `workspace.routes.ts`, and `project.routes.ts` is now `await`ed instead of fire-and-forget. The Redis SCAN+DEL is single-digit ms; the prior fire-and-forget pattern returned the write response before Redis had finished invalidating, so a client doing read-after-write within the same connection (most visibly: integration tests, but also a fast SPA refresh) could race and HIT-read stale data. Closes the same class of bug `bbd9228`/`9c0215c` claimed to fix but only partially did

### Removed

- Legacy `test-auth.js`, `test-phase1.js`, `test-tasks.js` smoke scripts (Phase 1 leftovers). They had been failing silently in CI for months — they HTTP-called `localhost:3001`, but the workflow never started an API server, so `req.on('error', console.error)` swallowed every connection refusal and `main().catch` exited 0. Replaced by the Vitest integration suite which covers the same paths via in-process `app.request()`
- CI's `test` job renamed to `integration`; the broken `node test-*.js` step removed; the new step runs `npm run test:integration` from `apps/api`. `unit` and `integration` are now both first-class jobs after `lint`
- `server.ts` boot side-effects (MinIO bucket init, env-admin promotion, BullMQ workers, HTTP listener) are gated on `NODE_ENV !== 'test'` so importing `app` in tests is free. The auth + global rate limiters are also skipped in test mode — they target hostile traffic, not the rapid-fire request pattern of an integration suite. Dedicated rate-limiter tests are a follow-up
- New `closePool()` export on `db.ts` so integration tests can shut the connection pool down in `afterAll`, letting vitest worker processes exit cleanly

#### Phase 6 — Post-launch (Week 34 — Test harness bedrock)
- **Vitest 4** wired into `apps/api` and `apps/next-web`. API config (`apps/api/vitest.config.ts`) defines two projects: `unit` (no external services, runs every PR) and `integration` (placeholder — populated in Phase 2.B once SQL fixtures land). Web config (`apps/next-web/vitest.config.ts`) uses `jsdom` + `@testing-library/react` + `@testing-library/jest-dom` with the `@/` alias mirroring `tsconfig`
- Vitest 4 + Vite resolve NodeNext `.js`-suffixed relative imports out of the box — no alias-stripping needed despite `apps/api` using `"type": "module"` and the `import './foo.js'` convention everywhere
- Three seed test files (40 + 8 = 48 tests, ~1.4 s wall clock total via `npm test` at the repo root):
  - `apps/api/src/modules/auth/__tests__/auth.service.unit.test.ts` (19 tests) — `login` happy / wrong-password / lockout / MFA-required / no-password (OAuth-only) / unknown-email / expired-lockout, `mfaChallenge` TOTP / recovery-code consumption / already-consumed / invalid-token / disabled-MFA, `refreshAccessToken` rotation / replay (revoked) / expired / unknown, `forgotPassword` token-hash persistence + no-enumeration. `bcrypt` mocked at module scope to keep the suite fast; `mfaService` mocked to drive both factor branches
  - `apps/api/src/shared/middleware/__tests__/permissions.middleware.unit.test.ts` (21 tests) — every branch of `requirePermission`: 401 unauth / single slug / any-of array / `workspaceParam` (path + query) / `resolveWorkspace` cached across multi-gate routes / 404 on missing resource / `ownerOnly` (owner / non-owner / missing) / `ownerFallback` (primary-only / fallback+owner / fallback non-owner / neither / 404). Plus `loadPermissions` per-workspace caching
  - `apps/next-web/src/components/admin/__tests__/PermissionPicker.test.tsx` (8 tests) — scope filter, group-by-resource render, single toggle, group toggle (select all / deselect all), partial-selection badge, disabled propagation
- Test fixtures + `truncateAll` helper (`apps/api/src/__tests__/fixtures/{factories.ts,truncate.ts}`) created as Phase 2.B placeholders. The truncate file documents the FK-safe table order so the eventual implementation can drop straight in
- `npm test` at the repo root runs both apps in parallel via Turbo; `npm run test:integration` is wired but no-op until 2.B
- New CI job `unit` runs alongside `lint`, `build`, and `test`. Documented inline that the legacy `node test-*.js` scripts in the `test` job have been failing silently (they HTTP-call `localhost:3001`, but the workflow never starts an API server) — Phase 2.B will replace them with real Vitest integration tests

#### Phase 6 — Post-launch (Week 33 — Workspace soft-delete + Task time-of-day deadlines)
- **Migration `0023_workspace_deletedat.sql`** — adds `Workspaces.DeletedAt DATETIME2 NULL` plus a filtered non-clustered index `IX_Workspaces_DeletedAt … WHERE DeletedAt IS NULL` to keep "list active workspaces" cheap. Idempotent
- `usp_Workspace_Delete` now stamps `DeletedAt = SYSUTCDATETIME()` instead of issuing a physical `DELETE`, mirroring the soft-delete pattern Users and Projects already use. `usp_Workspace_GetById` and `usp_Workspace_List` filter `DeletedAt IS NULL` so soft-deleted workspaces disappear from the API surface
- **Migration `0024_task_duedate_datetime.sql`** — widens `Tasks.DueDate` from `DATE` to `DATETIME2`. Existing day-only values implicitly become same-day-at-00:00:00, so reports / filters that compare against `CAST(GETDATE() AS DATE)` keep returning the same rows. The three covering indexes from `0016_perf_indexes.sql` that carry `DueDate` in their `INCLUDE` list (`IX_Task_ProjectId_Status`, `IX_Task_SprintId_Status`, `IX_Task_ReporterId_Status`) are dropped and recreated around the `ALTER COLUMN`. Idempotent: skips when the column is already `DATETIME2`
- `StartDate` deliberately stays `DATE` — the only producer is the Gantt drag-to-set-dates flow on the roadmap, which is a day-granular planning view
- `usp_Task_Create`, `usp_Task_Update`, and `usp_Task_UpdateDates` updated to bind `DueDate` as `sql.DateTime2` instead of `sql.Date`
- `TaskDrawer` "Deadline" field becomes `<input type="datetime-local">` so users can express "due by 17:00" rather than just a calendar day

### Fixed

- `DELETE /api/v1/workspaces/:id` previously returned 500 in v1.0.0: the SP attempted a physical delete but `Projects`, `Sprints`, `Tasks`, `WorkflowDefinitions`, and `UserRoles` all hold `REFERENCES Workspaces(Id)` without `ON DELETE CASCADE`, so every call hit a foreign-key violation. Migration 0023 + the rewritten `usp_Workspace_Delete` resolve the failure mode by switching to soft delete
- Newly-created tasks (most visibly EPICs) did not appear on the Epics page, Roadmap, or sprint summaries for up to 5 minutes after creation. `GET /epics/*`, `/roadmap/*`, and `/sprints/*` are server-cached in Redis (TTL 5 / 2 / 2 min), but `task.routes.ts` never busted those entries on write — so `POST /tasks` (and PATCH / DELETE / position / assignees / transition) left stale data behind. The Board appeared fresh because `/tasks` itself is not server-cached. Added `invalidateTaskCaches(projectId?)` and call it after every task mutation, mirroring the pattern components / labels / versions already use
- Same class of bug on `/workspaces/*` and `/projects/*` (both TTL.SHORT = 30 s): a newly-created workspace stayed invisible on the workspaces page until the user navigated away long enough for the cache to expire, then back. Added `invalidateWorkspaceCaches()` to all 7 workspace write paths (create, update, soft-delete, member add by id / by email, member remove, role change) and `invalidateProjectCaches()` to all 4 project write paths (create, update, archive, delete)

### Added

#### Phase 6 — Post-launch (Week 32 — Admin user management)
- **Migration `0022_admin_user_perms.sql`** — adds five admin user-management permission slugs (`admin.users.{create,update,delete,reset_password,reset_mfa}`) and grants the full set to both `super-admin` and `user-admin`. Splitting recovery actions (reset password, reset MFA + lockout) from `delete` lets an org grant help-desk staff the recovery slugs without granting the destructive one. Idempotent
- 6 new admin-only stored procedures: `usp_Admin_User_Create` (skips the self-registration flow — admin sets a temporary password directly), `usp_Admin_User_Update` (name/email), `usp_Admin_User_HardDelete` (refuses if any FK reference remains; returns the blocking count so the API can surface a useful error), `usp_Admin_User_SetPassword` (force-reset to a temporary value), `usp_Admin_User_DisableMfa` (clears `MfaSecret` and every `MfaRecoveryCodes` row in one transaction), `usp_Admin_User_Unlock` (clears `LockedUntil` and the failed-login counter from migration 0017)
- Matching REST endpoints under `/api/v1/admin/users`, each gated on the corresponding slug from 0022

#### Phase 6 — Post-launch (Week 32 — TOTP MFA)
- **Migration `0021_mfa_recovery_codes.sql`** — adds `Users.MfaEnabledAt` audit timestamp + `dbo.MfaRecoveryCodes` (UserId, CodeHash, CreatedAt, indexed on UserId). The `MfaEnabled` and `MfaSecret` columns from `0001_init.sql` are reused
- 7 new stored procedures: `usp_User_GetMfaState`, `usp_User_SetMfaPending` (refuses if MFA already enabled — error 51020), `usp_User_EnableMfa`, `usp_User_DisableMfa` (transactionally clears secret + every recovery code), `usp_MfaRecovery_CreateBatch` (parses newline-separated bcrypt hashes via `STRING_SPLIT` and replaces the user's batch atomically), `usp_MfaRecovery_ListHashes`, `usp_MfaRecovery_Consume` (returns `@@ROWCOUNT` so the caller can distinguish "consumed" from "already used")
- New `apps/api/src/modules/auth/mfa.service.ts` wrapping `otplib` v13 (functional API: `generateSecret`/`generateURI`/`verifySync`). `verifyTotp` uses `epochTolerance: 1` to forgive ±30s of clock drift. Recovery codes are 10 codes per enrolment in `XXXX-XXXX-XX` format using a 31-char alphabet that omits ambiguous `0/O/1/I/l`, bcrypt-hashed at cost 12
- Login flow now MFA-aware: `POST /api/v1/auth/login` returns `{ mfaRequired: true, mfaToken }` (a 5-minute purpose-scoped JWT) instead of access/refresh tokens when the user has TOTP enabled. Failed-login counters are NOT cleared at this stage — only the second-factor success clears them
- New endpoints (all on `/api/v1/auth`):
  - `POST /mfa/setup` (auth required) → `{ secret, otpauthUri }`. Stores the secret as pending; the URI feeds straight into a QR renderer
  - `POST /mfa/verify-setup` (auth required, body `{ code }`) → enables MFA on first valid TOTP, returns 10 plaintext recovery codes (one-time view)
  - `POST /mfa/disable` (auth required, body `{ password, code }`) → requires both factors so a stolen access token alone can't strip MFA. Recovery codes accepted in lieu of TOTP
  - `POST /mfa/challenge` (body `{ mfaToken, code? | recoveryCode? }`) → completes the second step, issues real session tokens, sets the refresh-token cookie
- Defense in depth: TOTP and recovery code paths use the same code path for token issuance (`AuthService.issueSessionTokens`), so `clearLoginAttempts` and `createRefreshToken` are guaranteed to fire identically regardless of the second-factor branch

## [Unreleased] — Phase 5

### Added

#### Phase 5 — Post-launch (Week 27 — RBAC)
- **Migration `0018_rbac.sql`** — four new tables (`Permissions`, `Roles`, `RolePermissions`, `UserRoles`), ~50 seeded permission slugs across SYSTEM and WORKSPACE scopes, 7 built-in roles (`super-admin`, `user-admin`, `auditor`, `workspace-owner`, `workspace-admin`, `workspace-member`, `workspace-viewer`), and a one-off backfill from `WorkspaceMembers.Role` into `UserRoles`
- **Phase 4 a11y polish** — closed gaps surfaced during the post-launch audit: skip-to-main-content link, `aria-current="page"` on the active sidebar item, `prefers-reduced-motion` and `pointer: coarse` (44 px touch-target floor) media queries, `apps/next-web/.env.example`, removed bogus `role="content"` on `<main>` and the obsolete `scripts/deploy-sps.bat`
- 14 stored procedures: `usp_Permission_List`, `usp_Role_{Create,Update,Delete,GetById,GetBySlug,List,ListMembers,SetPermissions}`, `usp_UserPermissions_Get`, `usp_UserRole_{Assign,AssignBySlug,List,Revoke}`
- `requirePermission(slug | slug[])` Hono middleware in `apps/api/src/shared/middleware/permissions.middleware.ts` with per-request context cache, workspace-param resolution, and any-of slug evaluation so a system-scoped admin permission can satisfy a workspace-scoped check (e.g. super-admin bypassing `workspace.delete`)
- `apps/api/src/shared/lib/envAdminBootstrap.ts` — startup hook that idempotently promotes every user listed in `ADMIN_USER_IDS` to the `super-admin` system role, with a warning-logged legacy fallback in the middleware until the env var is removed
- `/api/v1/admin/roles` and `/api/v1/admin/user-roles` REST endpoints (list/get/create/update/delete roles, replace permission set, list members, assign/revoke user roles), all gated by `admin.roles.manage`
- Admin endpoints (`/admin/stats`, `/admin/users[/:id/{suspend,restore}]`, `/admin/workspaces`, `/admin/audit-log`) now permission-gated rather than env-var-gated
- Workspace mutation routes now permission-gated: `PATCH /workspaces/:id` (`workspace.update`), `DELETE /workspaces/:id` (`workspace.delete` OR `admin.workspaces.delete`), `POST /workspaces/:id/members` (`workspace.members.invite`)
- `usp_Workspace_Create` and `usp_WorkspaceMember_Add` now bridge legacy `WorkspaceMembers` writes into `UserRoles` so the new gates work for workspaces and members created after migration 0018
- Admin UI: `RolesTab`, `RoleEditorDialog`, and `PermissionPicker` components in `apps/next-web/src/components/admin/` plus a "Roles & Permissions" tab on the admin page

#### Phase 5 — Post-launch (Week 28 — RBAC expansion to project/sprint/task)
- **Migration `0019_rbac_perms_extension.sql`** — adds the `project.{create,update,delete}` and `sprint.{create,start,complete,delete}` permission slugs that 0018 missed; grants them to `workspace-owner` (all), `workspace-admin` (all except `project.delete`), and `workspace-member` (creates + sprint ceremonies). Idempotent
- 3 new lookup stored procedures used by the middleware to derive a workspace from a resource id: `usp_Task_GetWorkspaceId`, `usp_Project_GetWorkspaceId`, `usp_Sprint_GetWorkspaceId` (sprint variant joins through `Projects`)
- `requirePermission` now accepts `resolveWorkspace?: (c) => Promise<string | null>` so resource-keyed routes (`/tasks/:id`, `/projects/:id`, `/sprints/:id/{start,complete}`) can be gated. The resolved id is cached on the Hono context so multi-gate requests don't re-query, and a `null` return now surfaces as a 404 rather than 403 (resource missing, not permission missing)
- `TaskRepository`, `ProjectRepository`, `SprintRepository` each gained a `getWorkspaceId(id)` helper that wraps the new SP
- Tasks routes gated: `POST /tasks` (`task.create`), `PATCH /tasks/:id` (`task.update`), `PATCH /tasks/:id/transition` (`task.transition`), `DELETE /tasks/:id` (`task.delete`)
- Projects routes gated: `POST /projects` (`project.create`), `PATCH /projects/:id` and `POST /projects/:id/archive` (`project.update`), `DELETE /projects/:id` (`project.delete`)
- Sprints routes gated: `POST /sprints` (`sprint.create`), `POST /sprints/:id/start` (`sprint.start`), `POST /sprints/:id/complete` (`sprint.complete`)

#### Phase 5 — Post-launch (Week 29 — ownership-aware RBAC for comments/attachments/worklogs)
- **Middleware extension** in `apps/api/src/shared/middleware/permissions.middleware.ts`:
  - `ownerOnly: (c) => Promise<userId | null>` — *tightens* the primary check; the user must hold the slug AND be the resource owner. A `null` return surfaces as 404 (resource missing, not 403). Used for `*.own`-only perms like `comment.update.own`
  - `ownerFallback: { slug, resolveOwner }` — *widens* the primary check; if the user lacks the primary slug, they still pass when they hold the fallback slug AND are the owner. Encodes "DELETE my own comment" alongside "DELETE any comment"
- 3 new lookup SPs returning `{ WorkspaceId, OwnerId }` in one round-trip: `usp_Comment_GetContext`, `usp_Attachment_GetContext`, `usp_WorkLog_GetContext` (all join through `Tasks`)
- Each repository gained a `getContext(id)` helper. The route caches the result on the Hono context so PATCH/DELETE pay one SP call even when both `resolveWorkspace` and the owner check fire
- Comments routes gated: `POST` (`comment.create` via task→workspace), `PATCH /:id` (`comment.update.own` ownerOnly — admins cannot edit others' comments), `DELETE /:id` (`comment.delete.any` with `comment.delete.own` ownerFallback), `POST /:id/reactions` (`comment.create`)
- Attachments routes gated: `POST` (`attachment.create`; multipart body parsed once and cached on context to avoid double-stream-read), `DELETE /:id` (`attachment.delete.any` with `attachment.delete.own` ownerFallback)
- Worklogs routes gated: `POST` (`worklog.create`), `PATCH /:id` (`worklog.update.own` ownerOnly), `DELETE /:id` (`worklog.delete.any` with `worklog.delete.own` ownerFallback)
- Defense in depth: existing service/SP-level owner checks are preserved; the new middleware adds an explicit permission gate in front of them

#### Phase 5 — Post-launch (Week 30 — RBAC wiring across remaining workspace-scoped modules)
- 8 new lookup SPs (all `Get…WorkspaceId`): `usp_Version_…`, `usp_Label_…`, `usp_Component_…`, `usp_Workflow_…`, `usp_WorkflowStatus_…` (joins through Workflows), `usp_Automation_…`, `usp_Webhook_…` (direct `WorkspaceId` column), `usp_GitConnection_…` (direct column)
- Each affected repository gained a `getWorkspaceId(id)` helper. Workflow's repo also gained `getWorkspaceIdByStatus(statusId)` for the `/workflows/statuses/:statusId` routes
- Versions routes gated: `POST` (`version.create` via project lookup), `PATCH` + `POST /:id/release` + `POST /:id/archive` (`version.update`), `DELETE` (`version.delete`)
- Labels routes gated: `POST` / `PATCH` / `DELETE` all on `label.manage` (single permission per Phase 5 design)
- Components routes gated: `POST` / `PATCH` / `DELETE` all on `component.manage`
- Workflows routes gated: `POST` (`workflow.update` via project lookup), `POST /:wfId/statuses` and `POST /:wfId/transitions` and `DELETE /:wfId/transitions` via workflow lookup, `PATCH` and `DELETE /statuses/:statusId` via the new status→workflow→workspace lookup
- Automation routes gated: `POST` (`automation.create`), `PATCH` and `POST /:id/toggle` (`automation.update`), `DELETE` (`automation.delete`)
- Outgoing webhooks routes gated: `POST` (`webhook.manage` via body), `DELETE /:id` and `POST /:id/ping` (`webhook.manage` via webhook lookup)
- Git integration routes gated: `POST /git/connections` (`git.integration.manage` via body), `DELETE /git/connections/:id` via connection lookup
- Roadmap routes gated: `PATCH /roadmap/tasks/:id/dates`, `POST /roadmap/dependencies`, `DELETE /roadmap/dependencies/:taskId/:dependsOn` — all `task.update` since they mutate Tasks rows; workspace derived from the relevant task

### Security

- Closes a v1.0.0 vulnerability: prior to this release any authenticated user could `DELETE /api/v1/workspaces/:id` (no permission check beyond `authMiddleware`). Now requires `workspace.delete` (workspace-scoped) or `admin.workspaces.delete` (system-scoped)
- Same vulnerability class on `DELETE /api/v1/tasks/:id`, `DELETE /api/v1/projects/:id`, `POST /api/v1/sprints/:id/{start,complete}`, and the create/update mutations on those resources is closed by Week 28's gating
- Week 29 closes the same class on comments/attachments/worklogs and additionally enforces author-only edits on `PATCH /comments/:id` and `PATCH /worklogs/:id` (admins with `*.update.own` perms still cannot edit other users' content)
- Week 30 closes the remaining ungated mutation surface: any authenticated workspace member could previously delete a project, edit a workflow, create/delete an automation rule, modify a webhook configuration, or attach/detach a git connection without an explicit permission check

#### Phase 5 — Post-launch (Week 31 — legacy cleanup)
- **Migration `0020_drop_workspacemembers_role.sql`** — drops the free-text `WorkspaceMembers.Role` column. The Week 27 audit confirmed zero readers remain (no SP queries it for business logic; no API/frontend code consumes it). Idempotent: detects and drops any default constraint bound to the column before the `ALTER TABLE … DROP COLUMN`
- `usp_Workspace_Create` no longer writes to the dropped column. The `dbo.UserRoles` insert (added Week 27) is now the sole record of role membership at workspace creation
- `usp_WorkspaceMember_Add` no longer writes to the dropped column. The `@Role` parameter remains in the API contract — it now drives only the role-slug → `dbo.UserRoles` insert. The result set replaces `SELECT *` with an explicit column list (`Id, WorkspaceId, UserId, JoinedAt, RoleSlug`) so callers still receive the effective role string in one round-trip
- `permissions.middleware.ts` — removed the `LEGACY_ADMIN_IDS` env-var fallback and its warning log. `envAdminBootstrap.ts` (run on every server start) is the canonical promotion path; the safety net is no longer needed and would mask drift between the env var and the DB if it stayed
- `ADMIN_USER_IDS` env var still works for first-time bootstrap of a fresh deploy — the startup hook reads it and assigns `super-admin` once. After that, role membership is managed entirely through `/api/v1/admin/user-roles`

### Known follow-ups

- Notifications, integrations, search, reports — most are read-only or per-user (notifications) and don't need workspace-scoped gates; remaining triage is mostly hardening rather than new gates
- Epic routes (`epicRoutes`) currently expose only `GET /epics?projectId=`; if write endpoints are added, gate with the existing `epic.{create,update,delete}` perms (already in seed 0018)
- All Phase 5 RBAC follow-ups closed

---

## [1.0.0] — 2026-05-08

### Added

#### Phase 1 — Foundation (Weeks 1–6)
- Turborepo monorepo with `apps/api` (Hono.js) and `apps/next-web` (Next.js 14)
- Docker Compose stack: MS SQL Server 2022, Redis 7, MinIO
- GitHub Actions CI pipeline (lint, build, test)
- Numbered SQL migration runner (`scripts/db-migrate.ts`)
- Idempotent stored-procedure deployer (`scripts/db-deploy-sps.ts`)
- Authentication: register, login, JWT (15 min access / 7 day refresh), OAuth skeleton
- Stored procedures: `usp_User_*`, `usp_RefreshToken_*`, `usp_PasswordReset_*`
- Workspace & Project CRUD + member management (`usp_Workspace_*`, `usp_Project_*`, `usp_WorkspaceMember_Add`)
- Task / Issue CRUD with custom workflow statuses (`usp_Task_*`, `usp_Task_Transition`)
- Kanban Board UI — static columns, drag-and-drop via @dnd-kit
- Backlog view + Sprint creation (`usp_Sprint_Create`, `usp_Sprint_Start`)

#### Phase 2 — Core Features (Weeks 7–14)
- Sprint start/complete with burndown chart (`usp_Sprint_Complete`, `usp_Report_Burndown`)
- Comments: TipTap rich text, @mentions, emoji reactions (`usp_Comment_*`)
- File attachments via MinIO / Azure Blob with signed URLs (`usp_Attachment_*`)
- In-app WebSocket notifications + email delivery via BullMQ (`usp_Notification_*`)
- Advanced search: PQL (ProjectFlow Query Language) parser + `usp_Task_Search_PQL`
- Roadmap / Timeline Gantt view (`usp_Roadmap_GetItems`)
- Custom workflow editor with transition validation SPs (`usp_Workflow_*`)
- Dashboards: velocity, workload, created-vs-resolved, sprint summary reports (`usp_Report_*`)

#### Phase 3 — Advanced Features (Weeks 15–22)
- Automation engine: trigger → condition → action processor via BullMQ (`usp_AutomationRule_*`)
- Time tracking: work logs with per-sprint roll-ups (`usp_WorkLog_*`)
- Versions, Epics, Components, Labels with full SP coverage
- GitHub / GitLab integration: webhooks, PR + commit linking (`usp_GitPR_*`, `usp_GitCommit_*`)
- Slack + Microsoft Teams integration for channel notifications
- Outgoing webhooks with delivery queue, retry logic, HMAC-SHA256 signatures
- GraphQL API via Pothos schema builder and graphql-yoga (`/api/v1/graphql`)
- Admin panel: user management, workspace stats, full audit log viewer (`usp_Admin_*`, `usp_AuditLog_*`)

#### Phase 4 — Polish & Launch (Weeks 23–26)
- **Week 23** — Mobile responsive layout + WCAG 2.1 AA accessibility
  - Skip links, `aria-current`, `aria-expanded`, `role="tabpanel"` pattern throughout
  - Off-canvas hamburger sidebar for ≤768 px viewports
  - `prefers-reduced-motion` and `pointer: coarse` (44 px touch targets) media queries
  - Board and Column components annotated with ARIA list roles and labels
- **Week 24** — Performance: Redis cache expansion + SP execution plan tuning
  - `cache.ts`: ioredis singleton with `withCache`, `TTL`, `CacheKey` helpers; graceful fallback when Redis is unreachable
  - `responseCache` middleware: caches 2xx GET responses with `X-Cache: HIT/MISS` headers
  - Response cache applied to labels (15 min), components (15 min), versions/epics (5 min), sprints/roadmap (2 min), workspaces/projects (30 s), admin stats (5 s)
  - Rate-limiter upgraded from in-memory Map to Redis INCR + EXPIRE with in-memory fallback
  - DB connection pool tuned: `max` 20→50, `min` 2→5, `acquireTimeoutMillis`, `connectionTimeout`
  - `trackQueryTime()` logs slow SPs (>500 ms) to stderr
  - Migration 0016: 11 covering non-clustered indexes on Tasks, Comments, Notifications, WorkspaceMember, Project, Sprint, WorkLog, RoadmapItem + `UPDATE STATISTICS … WITH FULLSCAN`
- **Week 25** — Security audit + fix cycle (OWASP Top 10)
  - `securityHeaders` middleware: CSP, HSTS (production), X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, COEP, CORP
  - `X-Powered-By` and `Server` headers removed to prevent fingerprinting
  - CORS upgraded to whitelist-array origin validation with `exposeHeaders`
  - Body-size guard: 413 for payloads >4 MB
  - bcrypt cost factor raised from 10 → **12**
  - `JWT_SECRET` validated at startup — throws in production if missing or using default value
  - Account lockout: 5 consecutive failed logins → 15-minute lock (migration 0017, `usp_User_RecordFailedLogin`, `usp_User_ClearLoginAttempts`)
  - Refresh token cookie hardened: `SameSite=Strict`
- **Week 26** — Docs site, public launch, v1.0.0
  - Root `README.md` rewritten for public launch
  - `.env.example` files for API and Next.js app
  - TypeScript migration runner (`scripts/db-migrate.ts`)
  - TypeScript SP deployer (`scripts/db-deploy-sps.ts`) replacing the `.bat` script
  - GitHub Actions CI (`ci.yml`) and production deploy (`deploy-prod.yml`) workflows
  - This CHANGELOG

### Security

- All database access via parameterised Stored Procedures — SQL injection architecturally prevented
- JWT access tokens (15 min) + httpOnly/Secure/SameSite=Strict refresh cookies (7 days, rotated on use)
- Password reset tokens: SHA-256 hashed, 1-hour expiry, single-use
- Account lockout after 5 failed logins (15-minute lockout)
- TLS 1.3 enforced; SQL Server `encrypt=true`
- Signed MinIO URLs with 15-minute expiry
- Sensitive fields (`PasswordHash`, `MfaSecret`) never returned in API responses
- Full audit log for all write operations
- HMAC-SHA256 signatures on all outgoing webhooks

[1.0.0]: https://github.com/your-org/projectflow/releases/tag/v1.0.0
