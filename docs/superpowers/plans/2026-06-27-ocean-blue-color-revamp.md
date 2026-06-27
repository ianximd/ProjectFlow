# Ocean Blue Color Revamp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-theme the whole `apps/next-web` app from the monochrome zinc palette to an Ocean Blue brand accent on a Slate neutral base, in both light and dark mode.

**Architecture:** A single-file change. All UI color comes from CSS custom properties defined in `:root` (light) and `.dark` (dark) in `apps/next-web/src/styles/globals.css`. Components read these via the `@theme inline` mapping, so swapping the variable values re-themes every component automatically. No component, layout, or markup edits.

**Tech Stack:** Tailwind CSS v4 (`@theme`), CSS custom properties, Next.js (`apps/next-web`).

## Global Constraints

- Only one file changes: `apps/next-web/src/styles/globals.css`. No component edits.
- Keep unchanged: `--destructive` (red-600), `--destructive-foreground`, `--chart-1…5`, `--radius`, the `@theme inline` block, all Metronic/sizing variables, and all non-color CSS.
- Neutral tokens move `zinc → slate`; brand (`--primary`, `--ring`) moves to blue.
- Reference values via Tailwind color vars (`var(--color-slate-100)` etc.) to match the file's existing style — do NOT hardcode hex in the token definitions.
- Full token mapping is authoritative in: `docs/superpowers/specs/2026-06-26-ocean-blue-color-revamp-design.md`.

---

### Task 1: Swap theme tokens to Ocean Blue on Slate (light + dark)

**Files:**
- Modify: `apps/next-web/src/styles/globals.css:10-63`

**Interfaces:**
- Consumes: existing `@theme inline` mapping (lines 66–88) which exposes `--color-primary`, `--color-ring`, `--color-background`, etc. — unchanged.
- Produces: re-valued `:root` and `.dark` custom properties. No new names; consumers are unaffected.

- [ ] **Step 1: Replace the `:root` (light mode) color block**

In `apps/next-web/src/styles/globals.css`, replace the current `:root { … }` block (lines 10–36) so the color tokens read exactly as below.

```css
:root {
  --background: var(--color-white);
  --foreground: var(--color-slate-950);
  --card: var(--color-white);
  --card-foreground: var(--color-slate-950);
  --popover: var(--color-white);
  --popover-foreground: var(--color-slate-950);
  --primary: var(--color-blue-600);
  --primary-foreground: var(--color-white);
  --secondary: var(--color-slate-100);
  --secondary-foreground: var(--color-slate-900);
  --muted: var(--color-slate-100);
  --muted-foreground: var(--color-slate-500);
  --accent: var(--color-slate-100);
  --accent-foreground: var(--color-slate-900);
  --destructive: var(--color-red-600);
  --destructive-foreground: var(--color-white);
  --chart-1: var(--color-blue-500);
  --chart-2: var(--color-green-500);
  --chart-3: var(--color-yellow-500);
  --chart-4: var(--color-red-500);
  --chart-5: var(--color-purple-500);
  --border: var(--color-slate-200);
  --input: var(--color-slate-200);
  --ring: var(--color-blue-500);
  --radius: 0.5rem;
}
```

Note: the old `--border` used a custom oklch value; it is intentionally replaced with `var(--color-slate-200)`.

- [ ] **Step 2: Replace the `.dark` (dark mode) color block**

Replace the current `.dark { … }` block (lines 38–63) so it reads exactly as below. Note `--primary-foreground` becomes white and `--ring` becomes blue.

```css
.dark {
  --background: var(--color-slate-950);
  --foreground: var(--color-slate-50);
  --card: var(--color-slate-950);
  --card-foreground: var(--color-slate-50);
  --popover: var(--color-slate-950);
  --popover-foreground: var(--color-slate-50);
  --primary: var(--color-blue-500);
  --primary-foreground: var(--color-white);
  --secondary: var(--color-slate-800);
  --secondary-foreground: var(--color-slate-50);
  --muted: var(--color-slate-900);
  --muted-foreground: var(--color-slate-400);
  --accent: var(--color-slate-800);
  --accent-foreground: var(--color-slate-50);
  --destructive: var(--color-red-600);
  --destructive-foreground: var(--color-white);
  --chart-1: var(--color-blue-500);
  --chart-2: var(--color-green-500);
  --chart-3: var(--color-yellow-500);
  --chart-4: var(--color-red-500);
  --chart-5: var(--color-purple-500);
  --border: var(--color-slate-800);
  --input: var(--color-slate-800);
  --ring: var(--color-blue-500);
}
```

- [ ] **Step 3: Build the web app to verify CSS compiles**

Run (from repo root): `pnpm --filter next-web build`
Expected: build completes with no CSS/Tailwind errors. (If the project uses `npm`/`yarn`, use the equivalent workspace build for `next-web`.)

For a faster check, run the dev server instead: `pnpm --filter next-web dev`, confirm it boots with no CSS errors, then stop it.

- [ ] **Step 4: Visual verification (light + dark)**

Start the dev server and open the app. Confirm in BOTH light and dark mode:
- Primary buttons, active nav item, links, and focus-visible rings are blue (not black/gray).
- Surfaces/borders read as cool slate (not warm zinc).
- "Destructive"/delete actions are still red; any amber warnings unchanged.
- Tab through a form: the focus ring (`--ring`) is clearly visible and blue (WCAG 2.4.7).

Check at least: a login/register page, the dashboard, and one list/table view.

- [ ] **Step 5: Commit**

```bash
git add apps/next-web/src/styles/globals.css
git commit -m "feat(web): Ocean Blue on Slate theme (light + dark)

Swap monochrome zinc palette for blue brand accent on a slate neutral
base across all theme tokens. Single-file token change; components
inherit via @theme. Destructive/chart/semantic colors unchanged.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage:** The spec's two changes (zinc→slate neutrals, brand→blue) and every token in both tables are covered by Steps 1–2. Kept-unchanged items (destructive, charts, radius) are preserved verbatim. Accessibility note (dark primary blue-500 + white, blue ring) is verified in Step 4. ✓
**2. Placeholder scan:** No TBD/TODO; every step shows the exact CSS or command. ✓
**3. Type consistency:** Token names match the existing `@theme inline` consumers exactly; no renames introduced. Dark `--ring` and `--primary-foreground` set per spec. ✓
