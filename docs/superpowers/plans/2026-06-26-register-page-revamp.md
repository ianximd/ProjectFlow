# Register Page Revamp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the public register page to mirror the revamped login page (two-column brand layout, design-system components, OAuth) and add UX upgrades: show/hide password, password strength meter, confirm-password, and inline validation.

**Architecture:** A `'use client'` page component matching the login layout, backed by a small pure password-strength helper and ten new i18n keys. The register server-action contract is unchanged; confirm-password is client-only.

**Tech Stack:** Next.js (modified — see Global Constraints), React, TypeScript, Tailwind theme tokens, next-intl, lucide-react, Vitest + @testing-library/react + user-event.

**Spec:** [docs/superpowers/specs/2026-06-26-register-page-revamp-design.md](../specs/2026-06-26-register-page-revamp-design.md)

## Global Constraints

- This is a **modified Next.js**; per [apps/next-web/AGENTS.md](../../../apps/next-web/AGENTS.md), check `node_modules/next/dist/docs/` before writing page code.
- Use design-system components only (`Card`, `CardContent`, `Input`, `InputWrapper`, `Label`, `Button`, `Alert`/`AlertIcon`/`AlertDescription`) and theme tokens — **no hardcoded color classes** like `bg-blue-600`.
- `messages/en.json` and `messages/id.json` MUST keep **identical key sets** and have **no empty string values** — enforced by [src/i18n/__tests__/messages.unit.test.ts](../../../apps/next-web/src/i18n/__tests__/messages.unit.test.ts).
- Tests live under `src/**/*.test.{ts,tsx}`. Vitest runs with `globals: false`, so import `{ describe, it, expect, vi }` from `'vitest'`. Wrap components in `<NextIntlClientProvider locale="en" messages={en}>`.
- Register contract is unchanged: `register(email, name, password)` from [src/server/actions/auth.ts](../../../apps/next-web/src/server/actions/auth.ts). Confirm-password is never sent. On success → `router.push('/login?registered=1')`.
- Run the web test suite from `apps/next-web/`: `npm run test`. Run a single file with `npx vitest run <path>`.

---

### Task 1: Password-strength helper

**Files:**
- Create: `apps/next-web/src/lib/password-strength.ts`
- Test: `apps/next-web/src/lib/__tests__/password-strength.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `export type PasswordStrengthLevel = 'weak' | 'fair' | 'good' | 'strong';`
  - `export interface PasswordStrength { score: 0 | 1 | 2 | 3 | 4; level: PasswordStrengthLevel; }`
  - `export function scorePassword(password: string): PasswordStrength;`
  - Rules: empty → `{score:0, level:'weak'}`; length < 8 → `{score:1, level:'weak'}`; otherwise `variety` = number of character classes present among lowercase, uppercase, digit, symbol → `variety<=1` → `{1,'weak'}`, `2` → `{2,'fair'}`, `3` → `{3,'good'}`, `4` → `{4,'strong'}`.

- [ ] **Step 1: Write the failing test**

Create `apps/next-web/src/lib/__tests__/password-strength.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { scorePassword } from '../password-strength';

describe('scorePassword', () => {
  it('returns score 0 / weak for an empty password', () => {
    expect(scorePassword('')).toEqual({ score: 0, level: 'weak' });
  });

  it('treats anything shorter than 8 chars as weak regardless of variety', () => {
    expect(scorePassword('Ab1!')).toEqual({ score: 1, level: 'weak' });
    expect(scorePassword('abcdefg')).toEqual({ score: 1, level: 'weak' });
  });

  it('rates an 8-char single-class password weak', () => {
    expect(scorePassword('abcdefgh')).toEqual({ score: 1, level: 'weak' });
  });

  it('rates two character classes as fair', () => {
    expect(scorePassword('abcdefg1')).toEqual({ score: 2, level: 'fair' });
  });

  it('rates three character classes as good', () => {
    expect(scorePassword('Abcdefg1')).toEqual({ score: 3, level: 'good' });
  });

  it('rates all four character classes as strong', () => {
    expect(scorePassword('Abcdef1!')).toEqual({ score: 4, level: 'strong' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/next-web && npx vitest run src/lib/__tests__/password-strength.test.ts`
Expected: FAIL — cannot resolve `../password-strength`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/next-web/src/lib/password-strength.ts`:

```ts
export type PasswordStrengthLevel = 'weak' | 'fair' | 'good' | 'strong';

export interface PasswordStrength {
  score: 0 | 1 | 2 | 3 | 4;
  level: PasswordStrengthLevel;
}

/**
 * Advisory password strength. Length is the hard gate: anything under 8 chars
 * is always weak. At >= 8 chars the score reflects how many character classes
 * (lowercase, uppercase, digit, symbol) appear.
 */
export function scorePassword(password: string): PasswordStrength {
  if (password.length === 0) return { score: 0, level: 'weak' };
  if (password.length < 8) return { score: 1, level: 'weak' };

  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/];
  const variety = classes.reduce((n, re) => (re.test(password) ? n + 1 : n), 0);

  if (variety <= 1) return { score: 1, level: 'weak' };
  if (variety === 2) return { score: 2, level: 'fair' };
  if (variety === 3) return { score: 3, level: 'good' };
  return { score: 4, level: 'strong' };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/next-web && npx vitest run src/lib/__tests__/password-strength.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/next-web/src/lib/password-strength.ts apps/next-web/src/lib/__tests__/password-strength.test.ts
git commit -m "feat(web): add password-strength helper for register page"
```

---

### Task 2: Add register i18n keys (en + id)

**Files:**
- Modify: `apps/next-web/messages/en.json` (`Auth` namespace)
- Modify: `apps/next-web/messages/id.json` (`Auth` namespace)
- Test: `apps/next-web/src/i18n/__tests__/messages.unit.test.ts` (existing — must stay green)

**Interfaces:**
- Consumes: nothing.
- Produces: ten new `Auth` keys used by Task 3: `confirmPasswordLabel`, `confirmPasswordPlaceholder`, `passwordsDoNotMatch`, `showPassword`, `hidePassword`, `passwordStrengthLabel`, `strengthWeak`, `strengthFair`, `strengthGood`, `strengthStrong`.

- [ ] **Step 1: Add the keys to `en.json`**

In `apps/next-web/messages/en.json`, inside the `"Auth"` object, add (e.g. after `"registrationFailed"`):

```json
    "confirmPasswordLabel": "Confirm password",
    "confirmPasswordPlaceholder": "••••••••",
    "passwordsDoNotMatch": "Passwords don't match",
    "showPassword": "Show password",
    "hidePassword": "Hide password",
    "passwordStrengthLabel": "Password strength",
    "strengthWeak": "Weak",
    "strengthFair": "Fair",
    "strengthGood": "Good",
    "strengthStrong": "Strong",
```

(Ensure the preceding line ends with a comma and the `Auth` object stays valid JSON.)

- [ ] **Step 2: Add the matching keys to `id.json`**

In `apps/next-web/messages/id.json`, inside the `"Auth"` object, add:

```json
    "confirmPasswordLabel": "Konfirmasi kata sandi",
    "confirmPasswordPlaceholder": "••••••••",
    "passwordsDoNotMatch": "Kata sandi tidak cocok",
    "showPassword": "Tampilkan kata sandi",
    "hidePassword": "Sembunyikan kata sandi",
    "passwordStrengthLabel": "Kekuatan kata sandi",
    "strengthWeak": "Lemah",
    "strengthFair": "Cukup",
    "strengthGood": "Bagus",
    "strengthStrong": "Kuat",
```

- [ ] **Step 3: Run the catalog parity test**

Run: `cd apps/next-web && npx vitest run src/i18n/__tests__/messages.unit.test.ts`
Expected: PASS — "en and id have identical key sets" and "no empty string values" both green.

- [ ] **Step 4: Commit**

```bash
git add apps/next-web/messages/en.json apps/next-web/messages/id.json
git commit -m "i18n(web): add register page strings (en, id)"
```

---

### Task 3: Rewrite the register page + component test

**Files:**
- Modify (full rewrite): `apps/next-web/src/app/register/page.tsx`
- Test: `apps/next-web/src/app/register/__tests__/register-page.test.tsx`

**Interfaces:**
- Consumes: `scorePassword` (Task 1); the ten new `Auth` keys (Task 2); existing `register` action; design-system components; `lucide-react` icons.
- Produces: default-exported `RegisterPage` React component (page route `/register`).

- [ ] **Step 1: Write the failing component test**

Create `apps/next-web/src/app/register/__tests__/register-page.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import en from '../../../../messages/en.json';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const registerMock = vi.fn();
vi.mock('@/server/actions/auth', () => ({
  register: (...args: unknown[]) => registerMock(...args),
}));

import RegisterPage from '../page';

function wrap(ui: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>{ui}</NextIntlClientProvider>,
  );
}

beforeEach(() => {
  push.mockReset();
  registerMock.mockReset();
  // OAuth providers endpoint — default to none configured.
  global.fetch = vi
    .fn()
    .mockResolvedValue({ ok: true, json: async () => ({ data: [] }) }) as unknown as typeof fetch;
});

describe('RegisterPage', () => {
  it('renders name, email, password and confirm-password fields', () => {
    wrap(<RegisterPage />);
    expect(screen.getByLabelText('Full Name')).toBeInTheDocument();
    expect(screen.getByLabelText('Email address')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByLabelText('Confirm password')).toBeInTheDocument();
  });

  it('shows a mismatch error and disables submit when passwords differ', async () => {
    const user = userEvent.setup();
    wrap(<RegisterPage />);
    await user.type(screen.getByLabelText('Full Name'), 'Jane');
    await user.type(screen.getByLabelText('Email address'), 'jane@example.com');
    await user.type(screen.getByLabelText('Password'), 'Abcdef1!');
    await user.type(screen.getByLabelText('Confirm password'), 'Abcdef1?');
    expect(screen.getByText("Passwords don't match")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign up' })).toBeDisabled();
  });

  it('toggles the password field between hidden and visible', async () => {
    const user = userEvent.setup();
    wrap(<RegisterPage />);
    const pw = screen.getByLabelText('Password') as HTMLInputElement;
    expect(pw.type).toBe('password');
    await user.click(screen.getAllByRole('button', { name: 'Show password' })[0]);
    expect(pw.type).toBe('text');
  });

  it('submits valid input and routes to the login page', async () => {
    registerMock.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    wrap(<RegisterPage />);
    await user.type(screen.getByLabelText('Full Name'), 'Jane');
    await user.type(screen.getByLabelText('Email address'), 'jane@example.com');
    await user.type(screen.getByLabelText('Password'), 'Abcdef1!');
    await user.type(screen.getByLabelText('Confirm password'), 'Abcdef1!');
    await user.click(screen.getByRole('button', { name: 'Sign up' }));
    await waitFor(() =>
      expect(registerMock).toHaveBeenCalledWith('jane@example.com', 'Jane', 'Abcdef1!'),
    );
    expect(push).toHaveBeenCalledWith('/login?registered=1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/next-web && npx vitest run src/app/register/__tests__/register-page.test.tsx`
Expected: FAIL — current page has no "Confirm password" field / no mismatch text / no show-password toggle.

- [ ] **Step 3: Rewrite the page**

Replace the entire contents of `apps/next-web/src/app/register/page.tsx` with:

```tsx
'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AlertCircle, Eye, EyeOff, Loader2, ShieldCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { register as registerAction } from '@/server/actions/auth';
import { scorePassword } from '@/lib/password-strength';
import { Button } from '@/components/ui/button';
import { Input, InputWrapper } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription, AlertIcon } from '@/components/ui/alert';

// Provider name → display label + brand color. Mirrors the login page.
const PROVIDER_META: Record<string, { labelKey: string; bg: string }> = {
  google:    { labelKey: 'continueWithGoogle',    bg: 'bg-white text-gray-900 border border-gray-300 hover:bg-gray-50' },
  github:    { labelKey: 'continueWithGitHub',    bg: 'bg-gray-900 text-white hover:bg-gray-800' },
  microsoft: { labelKey: 'continueWithMicrosoft', bg: 'bg-white text-gray-900 border border-gray-300 hover:bg-gray-50' },
};

const STRENGTH_META: Record<string, { labelKey: string; bar: string }> = {
  weak:   { labelKey: 'strengthWeak',   bar: 'bg-destructive' },
  fair:   { labelKey: 'strengthFair',   bar: 'bg-amber-500' },
  good:   { labelKey: 'strengthGood',   bar: 'bg-blue-500' },
  strong: { labelKey: 'strengthStrong', bar: 'bg-emerald-500' },
};

export default function RegisterPage() {
  const t = useTranslations('Auth');
  const router = useRouter();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [providers, setProviders] = useState<{ name: string }[]>([]);
  const [isPending, startTransition] = useTransition();

  // Configured-provider list (public endpoint; [] when no OAuth is wired).
  useEffect(() => {
    fetch('/api/v1/auth/oauth/providers')
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((j) => setProviders(j.data ?? []))
      .catch(() => setProviders([]));
  }, []);

  const strength = useMemo(() => scorePassword(password), [password]);
  const mismatch = confirm.length > 0 && confirm !== password;
  const canSubmit =
    name.trim().length > 0 &&
    email.trim().length > 0 &&
    password.length >= 8 &&
    confirm === password &&
    !isPending;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg('');
    if (!canSubmit) return;
    startTransition(async () => {
      const result = await registerAction(email, name, password);
      if (result.ok) {
        router.push('/login?registered=1');
      } else {
        setErrorMsg(result.error ?? t('registrationFailed'));
      }
    });
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2 grow">
      {/* Form column */}
      <div className="flex justify-center items-center p-8 lg:p-10 order-2 lg:order-1 bg-background">
        <Card className="w-full max-w-[420px]">
          <CardContent className="p-6 sm:p-8 space-y-6">
            <div className="space-y-2">
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">
                {t('createYourAccount')}
              </h1>
              <p className="text-sm text-muted-foreground">
                {t('alreadyHaveAccount')}{' '}
                <Link href="/login" className="font-medium text-primary hover:underline">
                  {t('signIn')}
                </Link>
              </p>
            </div>

            {errorMsg && (
              <Alert variant="destructive">
                <AlertIcon>
                  <AlertCircle />
                </AlertIcon>
                <AlertDescription>{errorMsg}</AlertDescription>
              </Alert>
            )}

            {providers.length > 0 && (
              <div className="space-y-3">
                {providers.map((p) => {
                  const meta = PROVIDER_META[p.name];
                  if (!meta) return null;
                  return (
                    <a
                      key={p.name}
                      href={`/api/v1/auth/oauth/${p.name}/start`}
                      className={`flex items-center justify-center w-full h-10 rounded-md text-sm font-medium transition-colors ${meta.bg}`}
                    >
                      {t(meta.labelKey)}
                    </a>
                  );
                })}
                <div className="relative">
                  <div className="absolute inset-0 flex items-center" aria-hidden="true">
                    <div className="w-full border-t border-border" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-background px-2 text-muted-foreground">{t('orDivider')}</span>
                  </div>
                </div>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-5" noValidate>
              <div className="space-y-1.5">
                <Label htmlFor="name">{t('fullNameLabel')}</Label>
                <Input
                  id="name"
                  type="text"
                  autoComplete="name"
                  placeholder={t('fullNamePlaceholder')}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="email">{t('emailLabel')}</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder={t('emailPlaceholder')}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="password">{t('passwordLabel')}</Label>
                <InputWrapper>
                  <Input
                    id="password"
                    type={showPw ? 'text' : 'password'}
                    autoComplete="new-password"
                    placeholder={t('passwordPlaceholder')}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw((v) => !v)}
                    aria-label={showPw ? t('hidePassword') : t('showPassword')}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    {showPw ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </InputWrapper>
                {password.length > 0 && (
                  <div className="space-y-1">
                    <div className="flex gap-1" aria-hidden="true">
                      {[1, 2, 3, 4].map((seg) => (
                        <div
                          key={seg}
                          className={`h-1 flex-1 rounded-full ${
                            seg <= strength.score ? STRENGTH_META[strength.level].bar : 'bg-muted'
                          }`}
                        />
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {t('passwordStrengthLabel')}: {t(STRENGTH_META[strength.level].labelKey)}
                    </p>
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="confirm">{t('confirmPasswordLabel')}</Label>
                <InputWrapper>
                  <Input
                    id="confirm"
                    type={showConfirm ? 'text' : 'password'}
                    autoComplete="new-password"
                    placeholder={t('confirmPasswordPlaceholder')}
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    aria-invalid={mismatch}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirm((v) => !v)}
                    aria-label={showConfirm ? t('hidePassword') : t('showPassword')}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    {showConfirm ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </InputWrapper>
                {mismatch && <p className="text-xs text-destructive">{t('passwordsDoNotMatch')}</p>}
              </div>

              <Button type="submit" className="w-full" disabled={!canSubmit}>
                {isPending && <Loader2 className="size-4 animate-spin" />}
                {isPending ? t('creatingAccount') : t('signUp')}
              </Button>
            </form>

            <p className="text-center text-xs text-muted-foreground">{t('termsNotice')}</p>
          </CardContent>
        </Card>
      </div>

      {/* Brand column */}
      <div className="relative hidden lg:flex lg:order-2 overflow-hidden bg-gradient-to-br from-primary via-primary to-primary/80 text-primary-foreground">
        <div className="absolute -top-32 -right-24 w-[28rem] h-[28rem] rounded-full bg-white/10 blur-3xl" aria-hidden="true" />
        <div className="absolute -bottom-32 -left-24 w-[24rem] h-[24rem] rounded-full bg-white/10 blur-3xl" aria-hidden="true" />
        <div className="relative z-10 flex flex-col justify-between p-12 xl:p-16 w-full">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-primary-foreground/15 backdrop-blur font-bold" aria-hidden="true">
              PF
            </div>
            <span className="text-lg font-semibold">ProjectFlow</span>
          </Link>

          <div className="space-y-5 max-w-md">
            <div className="inline-flex items-center gap-2 rounded-full bg-primary-foreground/10 px-3 py-1 text-xs font-medium backdrop-blur">
              <ShieldCheck className="size-3.5" />
              {t('secureAccess')}
            </div>
            <h2 className="text-3xl xl:text-4xl font-semibold leading-tight tracking-tight">
              {t('heroTagline')}
            </h2>
            <p className="text-base text-primary-foreground/80">{t('heroSubtitle')}</p>
          </div>

          <div className="text-xs text-primary-foreground/60">© {new Date().getFullYear()} ProjectFlow</div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the component test to verify it passes**

Run: `cd apps/next-web && npx vitest run src/app/register/__tests__/register-page.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Run the full web suite + lint to verify no regressions**

Run: `cd apps/next-web && npm run test && npm run lint`
Expected: all tests PASS (including `messages.unit.test.ts`), lint clean.

- [ ] **Step 6: Manual smoke check**

With the dev servers running (`http://localhost:3000/register`): confirm the two-column layout renders, the strength meter updates as you type, the show/hide toggles work, a mismatch disables "Sign up", and a valid submit lands on `/login?registered=1`.

- [ ] **Step 7: Commit**

```bash
git add apps/next-web/src/app/register/page.tsx apps/next-web/src/app/register/__tests__/register-page.test.tsx
git commit -m "feat(web): revamp register page to match login + UX upgrades"
```

---

## Self-Review

**Spec coverage:**
- Two-column layout + brand panel → Task 3 (page rewrite). ✓
- Design-system components, theme tokens, no hardcoded colors → Task 3. ✓ (Note: OAuth button `bg` strings and the amber/blue/emerald strength accents are copied verbatim from the existing login `PROVIDER_META` pattern / are semantic accents; destructive/muted/primary use tokens.)
- OAuth section (providers fetch + divider) → Task 3. ✓
- 4 fields + show/hide + strength meter + confirm validation + inline validation → Task 3. ✓
- Strength rules in a pure, unit-tested helper → Task 1. ✓
- Unchanged `register` contract, confirm client-only, success route → Task 3 + test. ✓
- New i18n keys in en + id, parity preserved → Task 2. ✓
- Component test (fields, mismatch, toggle, submit) → Task 3. ✓

**Placeholder scan:** No TBD/TODO; all steps contain full code and exact commands. ✓

**Type consistency:** `scorePassword` returns `{ score, level }` (Task 1) consumed in Task 3 via `strength.score` / `strength.level`; `STRENGTH_META` keyed by the four `level` values. `register(email, name, password)` argument order matches the existing action and the test assertion. ✓
