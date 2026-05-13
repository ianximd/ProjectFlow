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

### Step 3 — re-encrypt the backlog

Run the rotation worker (until it's built, do this manually):

```sql
-- How many rows still need re-encryption?
SELECT COUNT(*) FROM dbo.UserOAuthIdentities
WHERE TokenKeyVersion IS NOT NULL AND TokenKeyVersion <> 'v2';
```

For each such row, the worker reads `AccessTokenEnc`/`RefreshTokenEnc`,
decrypts via `tokenCrypto.open()`, re-seals via `tokenCrypto.seal()`
(now under v2), and writes back via `usp_UserOAuthIdentity_UpsertTokens`.

Let it finish before step 4.

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

`tokenCrypto.open()` will throw `key "v1" not present in keyset` for
every old row. You have two options:

- **Restore v1 to env** (if you still have it) and re-run rotation
  step 3.
- **Accept the loss.** Set `AccessTokenEnc = NULL`, `RefreshTokenEnc
  = NULL`, `TokenKeyVersion = NULL` on every row whose KeyVersion is
  no longer in the keyset. Those users will be re-prompted by the
  provider on next API call.

### "Key file isn't 32 bytes"

The module rejects this at load time with a descriptive error. The API
will fail to handle OAuth requests until env is fixed; sign-in via
password keeps working.

---

## Reference: env vars

| Variable                              | Required | Notes                                            |
|---------------------------------------|----------|--------------------------------------------------|
| `OAUTH_TOKEN_ENC_KEY_PRIMARY`         | optional | Id of the key new writes use (e.g. `v2`)         |
| `OAUTH_TOKEN_ENC_KEY_<id>`            | one+     | The key material; base64 of exactly 32 bytes     |

When `_PRIMARY` is unset, the module reports unconfigured and the
service silently skips token persistence. No errors, no warnings —
this is the supported "I don't need this feature" stance.
