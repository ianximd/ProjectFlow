# ProjectFlow Color Revamp — Ocean Blue on Slate

**Date:** 2026-06-26
**Status:** Approved (design)
**Scope:** Whole-app theme — `apps/next-web`

## Problem

The web app uses the shadcn default **monochrome zinc** palette: the brand/primary color is near-black (`zinc-900`), grays everywhere, and color reserved only for charts. It reads as flat and unbranded. The user wants a distinct brand color and a cohesive look across the whole app.

## Decision

Adopt an **Ocean Blue** brand accent on a **Slate** neutral base, for both light and dark mode. Two conceptual changes versus today:

1. **Neutral:** `zinc → slate` across all neutral tokens (cooler, pairs better with blue).
2. **Brand:** primary `near-black → blue`.

Chosen via visual comparison (brainstorming companion): Ocean Blue over Indigo/Emerald; Slate base over Zinc base.

## Constraints / Approach

- **Single source of truth:** All changes are CSS custom-property edits in `:root` and `.dark` in [`apps/next-web/src/styles/globals.css`](../../../apps/next-web/src/styles/globals.css) (lines ~10–63). No component edits, no new files.
- **Token propagation verified:** Metronic config (`config.metronic.css` → `demos/demo1.css`, `components/scrollable.css`) defines only sizing variables (sidebar width, header height) and reads theme tokens (`--color-input`, `currentColor`). It contains no hardcoded colors, so editing the theme tokens propagates everywhere automatically.
- **Kept unchanged:** `--destructive` (red-600), the `--chart-1…5` palette, amber/warning semantics, `--radius`, all sizing and Metronic variables.

## Token mapping

Values reference Tailwind v4 color variables (e.g. `var(--color-blue-600)`) to match the existing file's style. Hex shown for reference.

### Light mode (`:root`)

| Token | Current | New | Hex |
|---|---|---|---|
| `--background` | `--color-white` | `--color-white` | `#ffffff` |
| `--foreground` | `--color-zinc-950` | `--color-slate-950` | `#020617` |
| `--card` | `--color-white` | `--color-white` | `#ffffff` |
| `--card-foreground` | `--color-zinc-950` | `--color-slate-950` | `#020617` |
| `--popover` | `--color-white` | `--color-white` | `#ffffff` |
| `--popover-foreground` | `--color-zinc-950` | `--color-slate-950` | `#020617` |
| `--primary` | `--color-zinc-900` | `--color-blue-600` | `#2563eb` |
| `--primary-foreground` | `--color-white` | `--color-white` | `#ffffff` |
| `--secondary` | `--color-zinc-100` | `--color-slate-100` | `#f1f5f9` |
| `--secondary-foreground` | `--color-zinc-900` | `--color-slate-900` | `#0f172a` |
| `--muted` | `--color-zinc-100` | `--color-slate-100` | `#f1f5f9` |
| `--muted-foreground` | `--color-zinc-500` | `--color-slate-500` | `#64748b` |
| `--accent` | `--color-zinc-100` | `--color-slate-100` | `#f1f5f9` |
| `--accent-foreground` | `--color-zinc-900` | `--color-slate-900` | `#0f172a` |
| `--destructive` | `--color-red-600` | `--color-red-600` *(kept)* | `#dc2626` |
| `--destructive-foreground` | `--color-white` | `--color-white` | `#ffffff` |
| `--border` | custom oklch (~zinc-100/200) | `--color-slate-200` | `#e2e8f0` |
| `--input` | `--color-zinc-200` | `--color-slate-200` | `#e2e8f0` |
| `--ring` | `--color-zinc-400` | `--color-blue-500` | `#3b82f6` |
| `--chart-1…5` | blue/green/yellow/red/purple | *(kept)* | — |
| `--radius` | `0.5rem` | *(kept)* | — |

### Dark mode (`.dark`)

| Token | Current | New | Hex |
|---|---|---|---|
| `--background` | `--color-zinc-950` | `--color-slate-950` | `#020617` |
| `--foreground` | `--color-zinc-50` | `--color-slate-50` | `#f8fafc` |
| `--card` | `--color-zinc-950` | `--color-slate-950` | `#020617` |
| `--card-foreground` | `--color-zinc-50` | `--color-slate-50` | `#f8fafc` |
| `--popover` | `--color-zinc-950` | `--color-slate-950` | `#020617` |
| `--popover-foreground` | `--color-zinc-50` | `--color-slate-50` | `#f8fafc` |
| `--primary` | `--color-zinc-300` | `--color-blue-500` | `#3b82f6` |
| `--primary-foreground` | `--color-zinc-950` | `--color-white` | `#ffffff` |
| `--secondary` | `--color-zinc-800` | `--color-slate-800` | `#1e293b` |
| `--secondary-foreground` | `--color-zinc-50` | `--color-slate-50` | `#f8fafc` |
| `--muted` | `--color-zinc-900` | `--color-slate-900` | `#0f172a` |
| `--muted-foreground` | `--color-zinc-500` | `--color-slate-400` | `#94a3b8` |
| `--accent` | `--color-zinc-900` | `--color-slate-800` | `#1e293b` |
| `--accent-foreground` | `--color-zinc-50` | `--color-slate-50` | `#f8fafc` |
| `--destructive` | `--color-red-600` | `--color-red-600` *(kept)* | `#dc2626` |
| `--destructive-foreground` | `--color-white` | `--color-white` | `#ffffff` |
| `--border` | `--color-zinc-800` | `--color-slate-800` | `#1e293b` |
| `--input` | `--color-zinc-800` | `--color-slate-800` | `#1e293b` |
| `--ring` | `--color-zinc-600` | `--color-blue-500` | `#3b82f6` |

> Note: dark `--accent` moves from zinc-900 to slate-800 (one step lighter) so hover/selected states are visible against the slate-950 background. Dark `--muted-foreground` moves to slate-400 (brighter than the current zinc-500) for better secondary-text legibility on the darker base.

## Accessibility

- Dark-mode `--primary` = blue-500 with white foreground ≈ **3.7:1** contrast. Acceptable for large/bold button labels (WCAG AA for UI components / large text). Button label weight is kept as-is; no small blue-on-white text is introduced. If a future case needs small text on blue, use blue-600.
- Light-mode `--primary` = blue-600 with white ≈ **5.2:1** — passes AA for normal text.
- `--muted-foreground` light (slate-500 on white ≈ 4.8:1) and dark (slate-400 on slate-950 ≈ 6.9:1) both pass AA.
- Warning/destructive semantics unchanged.

## Out of scope

- No component/layout/markup changes.
- No new brand assets (logo, illustrations).
- No changes to the chart palette or status/semantic colors.

## Verification

- Visually confirm light + dark mode across: auth (login/register), dashboard, and a list/table view — primary buttons, active nav, links, focus rings now blue; surfaces read slate-neutral.
- Confirm focus-visible rings (`--ring`) render blue and remain clearly visible (WCAG 2.4.7).
- No console/build regressions (`globals.css` is the only changed file).
