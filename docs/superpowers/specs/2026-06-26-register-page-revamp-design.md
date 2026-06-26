# Register Page Revamp — Design

**Date:** 2026-06-26
**Status:** Approved
**Scope:** Visual parity with the login page + UX upgrades for the public register (create user) page.

## Problem

The login page ([apps/next-web/src/app/login/page.tsx](../../../apps/next-web/src/app/login/page.tsx))
was modernized to a two-column brand layout using the design-system components, OAuth
social buttons, and theme tokens. The register page
([apps/next-web/src/app/register/page.tsx](../../../apps/next-web/src/app/register/page.tsx))
is still the old style: raw Tailwind, a single centered card, hardcoded `bg-blue-600`
colors, an inline SVG error icon, no OAuth, and no shared components. The two auth pages
are visually inconsistent.

## Goal

Rebuild the register page so it mirrors the login page and adds UX upgrades:
show/hide password, a password strength meter, a confirm-password field, and inline
field validation.

## Non-goals

- No change to the backend `register` contract or auth flow.
- No password-policy change beyond the existing `minLength=8` (strength meter is advisory).
- No OAuth provider changes (reuse the existing providers endpoint and metadata).

## Architecture & Layout

`'use client'` component, same shell as login: `grid min-h-screen lg:grid-cols-2`.

- **Form column (left, `order-1`):** `Card` → `CardContent` containing:
  - Title "Create your account" + subtitle "Already have an account? Sign in" (link to `/login`).
  - Destructive `Alert` for server errors.
  - OAuth section: fetch `/api/v1/auth/oauth/providers` on mount; render a button per
    configured provider using the same `PROVIDER_META` map as login, followed by the
    "or" divider. Hidden entirely when no providers are configured.
  - The registration form.
- **Brand column (right, `order-2`, `hidden lg:flex`):** reuse the login gradient panel
  verbatim — logo, "Secure dashboard access" badge, hero tagline/subtitle, copyright.

Form left / brand right matches login exactly.

Components used: `Card`, `CardContent`, `Input`, `Label`, `Button`, `Alert` /
`AlertIcon` / `AlertDescription`, and `lucide-react` icons (`AlertCircle`, `Loader2`,
`ShieldCheck`, `Eye`, `EyeOff`, `Check`). No hardcoded color classes — theme tokens only.

## Fields & UX Upgrades

Field order: **Full name**, **Email**, **Password**, **Confirm password**.

- **Show/hide password toggle:** an eye / eye-off icon button positioned inside both the
  password and confirm-password inputs; toggles the input `type` between `password` and
  `text`. Each toggle has an `aria-label` (`showPassword` / `hidePassword`).
- **Password strength meter:** a 4-segment bar + label rendered under the password field.
  Strength is computed client-side from length and character-class variety
  (lowercase, uppercase, digit, symbol):
  - score 0–1 → Weak, 2 → Fair, 3 → Good, 4 → Strong.
  - Length < 8 always renders as Weak regardless of variety.
  - Advisory only; does not block submit on its own.
- **Confirm-password validation (client-only):** when confirm is non-empty and differs
  from password, show an inline error (`passwordsDoNotMatch`) under the confirm field.
- **Other inline validation:** name required (non-empty after trim); email must satisfy
  the input's `type="email"` validity. Submit is disabled while pending or while the form
  is invalid (empty required field, password < 8, or mismatch).
- **Submit button:** `Button`, full width, `Loader2` spinner + "Creating account…" while
  pending; label "Sign up" otherwise.

## Data Flow & Error Handling

- Calls the existing server action `register(email, name, password)`
  ([apps/next-web/src/server/actions/auth.ts](../../../apps/next-web/src/server/actions/auth.ts)).
- Confirm-password is **never sent** — client-side guard only.
- On `result.ok` → `router.push('/login?registered=1')` (unchanged from current behavior).
- On failure → message rendered in the destructive `Alert`.
- Client-side validation errors render inline and block submit before any network call.

## i18n

Reuse existing `Auth` keys: `createYourAccount`, `alreadyHaveAccount`, `signIn`,
`signUp`, `creatingAccount`, `fullNameLabel`, `fullNamePlaceholder`, `emailLabel`,
`emailPlaceholder`, `passwordLabel`, `passwordPlaceholder`, `termsNotice`, `orDivider`,
`secureAccess`, `heroTagline`, `heroSubtitle`, `continueWithGoogle`,
`continueWithGitHub`, `continueWithMicrosoft`, `registrationFailed`.

**New keys** (add to both `messages/en.json` and `messages/id.json`, `Auth` namespace):

| Key | EN value |
|---|---|
| `confirmPasswordLabel` | Confirm password |
| `confirmPasswordPlaceholder` | •••••••• |
| `passwordsDoNotMatch` | Passwords don't match |
| `showPassword` | Show password |
| `hidePassword` | Hide password |
| `passwordStrengthLabel` | Password strength |
| `strengthWeak` | Weak |
| `strengthFair` | Fair |
| `strengthGood` | Good |
| `strengthStrong` | Strong |

Indonesian translations to be provided for each new key.

## Testing

Component test for the register page:

- Renders all four fields and the OAuth section (mock the providers endpoint).
- Confirm-password mismatch shows the inline error and disables submit.
- Show/hide toggle flips the input `type`.
- Successful submit calls the `register` action with `(email, name, password)` and routes
  to `/login?registered=1`.

Follow the existing test setup/patterns used by comparable pages in the app.

## Implementation Notes

- Per [apps/next-web/AGENTS.md](../../../apps/next-web/AGENTS.md), this is a modified
  Next.js; check `node_modules/next/dist/docs/` before writing code.
- Password-strength scoring should live in a small pure helper so it can be unit-tested
  independently of the component.
