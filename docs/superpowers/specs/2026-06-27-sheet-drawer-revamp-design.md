# Sheet / Drawer Primitive Revamp

**Date:** 2026-06-27
**Status:** Approved (design)
**Scope:** `apps/next-web` — shared `components/ui/sheet.tsx` primitive

## Problem

All drawers/side-panels in the app (task detail, notifications, role editor, dashboard card config, automation run-history, mobile nav, etc.) are built on one `Sheet` primitive. The primitive is thin: left/right sheets are hard-capped at `sm:max-w-sm` (384px) with **no width option**, the header has no structure (centered on mobile, no divider), there is no internal scroll region, and motion is a flat linear slide. As a result every consumer hand-rolls width and header chrome (`className="w-full sm:max-w-2xl … p-0"` + a manual `px-6 py-4 border-b` header). The user wants the primitive itself revamped across four axes: visual polish, layout/density, motion, and width/responsiveness — so every drawer improves at once.

## Decision

Enhance `sheet.tsx` in place. Add a width `size` variant, give header/body/footer real structure with an internal scroll region, refine the visual treatment to the new Ocean Blue / Slate theme, and smooth the motion. **Fully backward-compatible**: consumer `className` is composed last (via `cn`) and continues to win, so existing drawers that pass their own widths/`p-0`/headers keep working unchanged.

## Requirements

### 1. Width — `size` variant (left/right only)

Add a `size` prop to `SheetContent`, applied for `side="left"` and `side="right"`:

| size | desktop width | mobile (< `sm`) |
|---|---|---|
| `sm` | `max-w-sm` (384px) | `w-full` |
| `md` (default) | `max-w-md` (~480px) | `w-full` |
| `lg` | `max-w-lg` (640px) | `w-full` |
| `xl` | `max-w-2xl` (768px) | `w-full` |
| `full` | `w-full` | `w-full` |

- Base for left/right becomes `w-full` with the desktop cap applied at `sm:`. (Replaces the current `w-3/4 sm:max-w-sm`.)
- `top`/`bottom` sides ignore `size` (unchanged behavior).
- Default `size` is `md`. Consumers passing an explicit width in `className` override it (verified: `cn` order keeps consumer classes last).

### 2. Structure — header / body / footer

`SheetContent` for left/right becomes a flex column with internal padding removed (`p-0`); the sub-components own their spacing:

- **`SheetHeader`**: `flex items-start justify-between gap-2 px-6 py-4 border-b border-border` — left-aligned (remove `text-center`), does not scroll.
- **`SheetBody`**: `flex-1 overflow-y-auto px-6 py-4` — the only scrolling region.
- **`SheetFooter`**: `px-6 py-4 border-t border-border flex flex-col-reverse gap-2 sm:flex-row sm:justify-end` — pinned at the bottom, does not scroll.
- `SheetContent` becomes `flex flex-col` with `h-full` (left/right) so the body scroll works.

Header/body/footer classes remain overridable by consumer `className`.

### 3. Visual polish

- **Shadow**: replace flat `shadow-lg` with a softer layered shadow (`shadow-xl`); inner edge border already present via `border-s`/`border-e`.
- **Close button**: keep top-end placement, align to the header row vertically (`top-4 end-5`), blue focus ring via existing `--ring` (now blue), `size-8` hit area with `rounded-md` hover background using `--accent`.
- **Title**: `text-base font-semibold text-foreground` (unchanged); description `text-sm text-muted-foreground` (unchanged).
- **Overlay**: `bg-slate-950/40` with `backdrop-blur-sm` (replaces `bg-black/30` + 4px blur) for a touch more depth on the new slate base.

### 4. Motion

- Slide transition uses a custom ease-out curve and duration tokens: open `~280ms`, close `~220ms`, `ease-[cubic-bezier(0.32,0.72,0,1)]`.
- Overlay fades in/out in tandem (existing `fade-in-0`/`fade-out-0`).
- The existing global `prefers-reduced-motion` rule in `styles/globals.css` already neutralizes animation durations; the revamp must keep all motion in classes (no inline transition styles) so that rule still applies.

## Constraints / Out of scope

- **Only** `apps/next-web/src/components/ui/sheet.tsx` changes. No consumer files edited in this work.
- No API removal: all current exports and props (`side`, `overlay`, `close`) stay. `size` is additive and optional.
- No migration of existing consumers to drop their boilerplate (can be a follow-up; not required and out of scope here).
- RTL behavior (`rtl:` slide direction classes) preserved.

## Accessibility

- Radix Dialog semantics (focus trap, `aria`, Esc-to-close) are inherited from `SheetPrimitive` and untouched.
- Close button keeps `sr-only` "Close" label and a visible blue focus ring (`--ring`).
- Header/body/footer are styling-only; no change to the title/description association Radix provides.
- Motion respects `prefers-reduced-motion` (see §4).

## Verification

- Run the app; open at least three drawers that exercise different consumers: task detail (`TaskDrawer`), notifications (`notifications-sheet`, sets its own width/`p-0`), and the role editor (`RoleEditorDialog`, `sm:max-w-2xl`). Confirm:
  - Existing drawers are visually unchanged in width/layout (their `className` still wins) — no regression.
  - A drawer rendered with the new `size` prop and the new header/body/footer scrolls correctly: header and footer pinned, body scrolls.
  - Focus ring on the close button is blue; overlay blur reads correctly in light and dark.
  - Reduced-motion preference disables the slide.
- `pnpm --filter next-web build` (or npm workspace equivalent) compiles with no type errors — `size` is a typed `VariantProps` addition.
