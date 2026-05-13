# OAuth token-encryption: setup and key rotation

ProjectFlow encrypts OAuth provider access/refresh tokens at rest with
AES-256-GCM. Each row stores the id of the key that encrypted it
(`UserOAuthIdentities.TokenKeyVersion`), so old rows stay decryptable
after a new primary key is introduced and rotation is incremental.

This runbook is for whoever owns the OAuth integration — typically the
person who would normally rotate JWT secrets and DB passwords.

---

## When to rotate

- **Yearly.** Calendar baseline.
- **On suspected compromise.** Anyone who shouldn't have had access to
  prod env vars (laid-off engineer, leaked dotenv, accidentally-public
  config repo).
- **Algorithm migration.** If we move off AES-256-GCM, we'll bump the
  format version (`v1` → `v2`) and the rotation worker re-encrypts.

If neither applies, do not rotate — every rotation is a window where a
miswired env var can break sign-in for everyone.

---

## Initial setup (greenfield deploy)

1. Generate a 32-byte key:

   ```bash
   openssl rand -base64 32
   ```

2. Add to the production env:

   ```bash
   OAUTH_TOKEN_ENC_KEY_PRIMARY=v1
   OAUTH_TOKEN_ENC_KEY_v1=<the base64 string from step 1>
   ```

   Key id rules: `[A-Za-z0-9_]{1,16}`. Convention is `v1`, `v2`, …;
   any string that fits works.

3. Restart the API. On the next OAuth sign-in, `UserOAuthIdentities`
   rows will get populated `AccessTokenEnc`, `TokenKeyVersion='v1'`,
   etc. Confirm with:

   ```sql
   SELECT TOP 5 Provider, TokenKeyVersion, LEN(AccessTokenEnc) AS bytes
   FROM dbo.UserOAuthIdentities WHERE TokenKeyVersion IS NOT NULL;
   ```

If `OAUTH_TOKEN_ENC_KEY_PRIMARY` is unset, the API still boots and
sign-in still works — token persistence is just skipped. This is the
opt-in stance for the OSS distribution.

---

## Rotation procedure

The goal is zero downtime: at every step the API can decrypt every
existing row. We achieve that by adding the new key BEFORE flipping
PRIMARY, then dropping the old key AFTER every row has been
re-encrypted.

### Step 1 — generate and stage the new key

```bash
openssl rand -base64 32
```

Add to env (do **not** flip PRIMARY yet):

```bash
OAUTH_TOKEN_ENC_KEY_v2=<new base64>
```

Restart the API. New deploys can decrypt anything sealed under v1
**or** v2; new writes still go out under v1.

> If you skip the restart, the next step breaks: the running process
> doesn't know v2 exists, so flipping PRIMARY=v2 makes every new
> sign-in fail.

### Step 2 — flip PRIMARY

```bash
OAUTH_TOKEN_ENC_KEY_PRIMARY=v2
```

Restart. From here, every new sign-in stores `TokenKeyVersion='v2'`.
Old `'v1'` rows are still decryptable because the v1 key is still in
env.

### Step 3 — let the rotation worker drain the backlog

The OAuth maintenance worker (Phase 1.E) runs every 15 minutes and
re-encrypts up to 100 rows per tick under the current PRIMARY. After
restarting the API in step 2, the worker is already on the case.

Watch progress with:

```sql
SELECT COUNT(*) FROM dbo.UserOAuthIdentities
WHERE TokenKeyVersion IS NOT NULL AND TokenKeyVersion <> 'v2';
```

For a small deployment this is usually zero within one tick. For a
large backlog, math: `(rows / 100) * 15 minutes`. If you need it done
faster, you can drop the worker's `ROTATION_INTERVAL_MS` in
`apps/api/src/modules/auth/oauth/workers/oauth-maintenance.worker.ts`
and redeploy — but don't go below ~1 minute, the SP isn't designed
for tighter polling.

Wait for the count to hit zero before step 4. The worker logs each
sweep when `scanned > 0`:

```
[oauth-maintenance] rotation sweep { primary: 'v2', scanned: 100, rotated: 100, failed: 0, remaining: 'maybe-more' }
```

When `remaining: 'caught-up'`, the backlog is drained.

### Step 4 — drop the old key

When the count from step 3 hits zero:

```bash
# Remove the v1 entry
unset OAUTH_TOKEN_ENC_KEY_v1
```

Restart. The keyset now has `{v2}` only and rotation is complete.

---

## Incident scenarios

### "I think v1 leaked"

You can't undo a leak — the attacker may have already stolen sealed
strings + the key. Treat it as a refresh-token compromise:

1. Run rotation steps 1–3 above as fast as you can.
2. After the backlog is re-encrypted, **also** revoke all stored
   refresh tokens (truncate `RefreshTokenEnc` to NULL across the
   table). Users will get re-prompted on the next provider call.
3. Audit `dbo.AuditLog` for `oauth.login` and `oauth.link` events from
   the leak window. Surface anything from unfamiliar IPs.

### "I dropped v1 before re-encrypting"

The rotation worker will start logging `[oauth/rotate] row failed …
key "v1" not present in keyset` for every affected row, and the
sweep result will show non-zero `failed`. You have two options:

- **Restore v1 to env** (if you still have it) and let the next sweep
  pick the rows up.
- **Accept the loss.** Set `AccessTokenEnc = NULL`, `RefreshTokenEnc
  = NULL`, `TokenKeyVersion = NULL` on every row whose KeyVersion is
  no longer in the keyset. Those users will be re-prompted by the
  provider on next API call.

### "Key file isn't 32 bytes"

The module rejects this at load time with a descriptive error. The API
will fail to handle OAuth requests until env is fixed; sign-in via
password keeps working.

---

## The other maintenance sweep: silent refresh

The same worker also runs a silent-refresh sweep every 5 minutes. It
finds identity rows whose access token will expire within ~10 minutes
**and** that have a stored refresh token, calls the provider's refresh
endpoint, and writes the new tokens back encrypted.

Operators don't normally need to touch this — it just keeps stored
tokens warm so future feature work (e.g. Calendar / Drive integrations)
finds an unexpired access token instead of having to refresh on the
critical path. With the current OAuth flows it's mostly a no-op:

- **Google** sign-in uses `access_type=online` and doesn't issue a
  refresh token. Rows have NULL `RefreshTokenEnc` → the SP filter
  excludes them. Adding a feature that needs offline access (e.g.
  Drive) means flipping `access_type=offline` in
  `providers/google.ts`.
- **GitHub** OAuth Apps don't issue refresh tokens at all. Same: no
  rows match the filter.
- **Microsoft** scopes already include `offline_access`, so refresh
  tokens DO get stored — these are the rows the sweep actually
  refreshes.

A failing refresh (revoked grant, expired refresh token) is logged
under `[oauth/refresh] row failed`, increments the `failed` counter,
and is otherwise harmless — the user re-authorises on the next
sign-in.

---

## Reference: env vars

| Variable                              | Required | Notes                                            |
|---------------------------------------|----------|--------------------------------------------------|
| `OAUTH_TOKEN_ENC_KEY_PRIMARY`         | optional | Id of the key new writes use (e.g. `v2`)         |
| `OAUTH_TOKEN_ENC_KEY_<id>`            | one+     | The key material; base64 of exactly 32 bytes     |

When `_PRIMARY` is unset, the module reports unconfigured and the
service silently skips token persistence. No errors, no warnings —
this is the supported "I don't need this feature" stance.
