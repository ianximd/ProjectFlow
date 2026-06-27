# Sheet / Drawer Primitive Revamp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Revamp the shared `sheet.tsx` drawer primitive — add a width `size` variant, structured scrollable header/body/footer, refined visuals, and smoother motion — backward-compatibly.

**Architecture:** Single-file change to the shadcn/Radix `Sheet` primitive. Adds a `size` CVA variant (applied only to left/right sheets), removes default padding from left/right content so the header/body/footer own spacing and the body becomes the scroll region, and updates overlay/close/shadow/motion classes. Consumer `className` stays composed last via `cn`, so existing drawers override and don't regress.

**Tech Stack:** React, Tailwind CSS v4, `class-variance-authority`, `radix-ui` Dialog, `tw-animate-css`.

## Global Constraints

- Only `apps/next-web/src/components/ui/sheet.tsx` changes. No consumer edits.
- All current exports and props (`side`, `overlay`, `close`) preserved; `size` is additive/optional, default `md`.
- `size` applies to `left`/`right` only; `top`/`bottom` stay full-width (pass `size: 'full'`).
- Keep all motion in classes (no inline transition styles) so the global `prefers-reduced-motion` rule still applies.
- Preserve RTL slide classes.

---

### Task 1: Revamp `sheet.tsx`

**Files:**
- Modify: `apps/next-web/src/components/ui/sheet.tsx` (full rewrite of the file)

**Interfaces:**
- Consumes: `cn` from `@/lib/utils`, `cva`/`VariantProps` from `class-variance-authority`, `Dialog as SheetPrimitive` from `radix-ui`, `X` from `lucide-react`.
- Produces: same named exports as today (`Sheet`, `SheetTrigger`, `SheetClose`, `SheetPortal`, `SheetOverlay`, `SheetContent`, `SheetHeader`, `SheetBody`, `SheetFooter`, `SheetTitle`, `SheetDescription`). `SheetContent` gains an optional `size?: 'sm'|'md'|'lg'|'xl'|'full'` prop (default `md`).

- [ ] **Step 1: Replace the entire file contents**

Replace `apps/next-web/src/components/ui/sheet.tsx` with exactly:

```tsx
'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { cva, type VariantProps } from 'class-variance-authority';
import { X } from 'lucide-react';
import { Dialog as SheetPrimitive } from 'radix-ui';

function Sheet({ ...props }: React.ComponentProps<typeof SheetPrimitive.Root>) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />;
}

function SheetTrigger({ ...props }: React.ComponentProps<typeof SheetPrimitive.Trigger>) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

function SheetClose({ ...props }: React.ComponentProps<typeof SheetPrimitive.Close>) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />;
}

function SheetPortal({ ...props }: React.ComponentProps<typeof SheetPrimitive.Portal>) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />;
}

function SheetOverlay({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Overlay>) {
  return (
    <SheetPrimitive.Overlay
      data-slot="sheet-overlay"
      className={cn(
        'fixed inset-0 z-50 bg-slate-950/40 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
        className,
      )}
      {...props}
    />
  );
}

const sheetVariants = cva(
  'flex flex-col fixed z-50 bg-background shadow-xl ease-[cubic-bezier(0.32,0.72,0,1)] transition data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:duration-200 data-[state=open]:duration-300',
  {
    variants: {
      side: {
        top: 'inset-x-0 top-0 gap-4 border-b p-6 data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top',
        bottom:
          'inset-x-0 bottom-0 gap-4 border-t p-6 data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom',
        left: 'inset-y-0 start-0 h-full w-full border-e data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left rtl:data-[state=closed]:slide-out-to-right rtl:data-[state=open]:slide-in-from-right',
        right:
          'inset-y-0 end-0 h-full w-full border-s data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right rtl:data-[state=closed]:slide-out-to-left rtl:data-[state=open]:slide-in-from-left',
      },
      size: {
        sm: 'sm:max-w-sm',
        md: 'sm:max-w-md',
        lg: 'sm:max-w-lg',
        xl: 'sm:max-w-2xl',
        full: '',
      },
    },
    defaultVariants: {
      side: 'right',
      size: 'md',
    },
  },
);

interface SheetContentProps
  extends React.ComponentProps<typeof SheetPrimitive.Content>,
    VariantProps<typeof sheetVariants> {
  overlay?: boolean;
  close?: boolean;
}

function SheetContent({
  side = 'right',
  size = 'md',
  overlay = true,
  close = true,
  className,
  children,
  ...props
}: SheetContentProps) {
  const isHorizontal = side === 'left' || side === 'right';
  return (
    <SheetPortal>
      {overlay && <SheetOverlay />}
      <SheetPrimitive.Content
        className={cn(sheetVariants({ side, size: isHorizontal ? size : 'full' }), className)}
        {...props}
      >
        {children}
        {close && (
          <SheetPrimitive.Close
            data-slot="sheet-close"
            className="cursor-pointer absolute end-5 top-4 inline-flex size-8 items-center justify-center rounded-md opacity-70 ring-offset-background transition-opacity hover:bg-accent hover:opacity-100 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none"
          >
            <X className="size-4" />
            <span className="sr-only">Close</span>
          </SheetPrimitive.Close>
        )}
      </SheetPrimitive.Content>
    </SheetPortal>
  );
}

function SheetHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sheet-header"
      className={cn('flex flex-col gap-1 border-b border-border px-6 py-4 pe-12 text-start', className)}
      {...props}
    />
  );
}

function SheetBody({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div data-slot="sheet-body" className={cn('flex-1 overflow-y-auto px-6 py-4', className)} {...props} />
  );
}

function SheetFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn(
        'flex flex-col-reverse gap-2 border-t border-border px-6 py-4 sm:flex-row sm:justify-end',
        className,
      )}
      {...props}
    />
  );
}

function SheetTitle({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn('text-base font-semibold text-foreground', className)}
      {...props}
    />
  );
}

function SheetDescription({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  );
}

export {
  Sheet,
  SheetBody,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetOverlay,
  SheetPortal,
  SheetTitle,
  SheetTrigger,
};
```

- [ ] **Step 2: Type-check / build**

Run from repo root: `npm run build --workspace=next-web` (pnpm equivalent: `pnpm --filter next-web build`).
Expected: compiles with no TypeScript errors. The `size` prop is a typed `VariantProps` addition; `SheetContentProps` now drives `SheetContent`'s signature.
If the build fails for reasons unrelated to this file (pre-existing errors elsewhere), capture output and report DONE_WITH_CONCERNS.

- [ ] **Step 3: Visual verification (human/controller — cannot be done by an automated agent)**

With the dev server running, open three drawers that exercise different consumers and confirm no regression + the new behavior:
- **Notifications** (topbar bell — `notifications-sheet.tsx`, sets its own `sm:w-[440px] p-0`): width and layout unchanged; close button blue focus ring; overlay blur reads in light + dark.
- **Role editor** (admin → roles — `RoleEditorDialog.tsx`, `sm:max-w-2xl ... p-0` with `SheetHeader`/border): unchanged width; header divider intact; long content scrolls inside the body with header/footer pinned.
- **Task detail** (`TaskDrawer.tsx`): opens and renders without clipped content. If padding looks lost because it relied on the old default `p-6`, note it — the consumer can add `SheetBody`/padding (follow-up, out of scope here).
- Toggle OS reduced-motion and confirm the slide animation is suppressed.

(There is no unit-test harness for this presentational primitive; the build + visual check is the verification.)

- [ ] **Step 4: Commit**

```bash
git add apps/next-web/src/components/ui/sheet.tsx
git commit -m "feat(web): revamp Sheet primitive — size variant, scroll body, polish, motion

Add size prop (sm/md/lg/xl/full) for left/right sheets, structured
sticky header/footer with scrollable body, refined overlay/close/shadow,
smoother eased slide. Backward-compatible via className override.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage:** §1 width `size` variant → Step 1 `size` CVA + `isHorizontal` gating (top/bottom forced `full`). §2 structure → `SheetContent` `flex flex-col`, no left/right padding; `SheetHeader` border-b, `SheetBody` `flex-1 overflow-y-auto`, `SheetFooter` border-t. §3 polish → `shadow-xl`, new close button (`size-8`, `hover:bg-accent`, blue `ring`), overlay `bg-slate-950/40 backdrop-blur-sm`. §4 motion → eased cubic-bezier, open 300 / close 200, fade overlay, classes-only. Backward-compat → `className` last in every `cn`. All covered. ✓
**2. Placeholder scan:** No TBD/TODO; full file content provided; commands explicit. ✓
**3. Type consistency:** `SheetContentProps` includes `VariantProps<typeof sheetVariants>` (`side`, `size`) plus `overlay`/`close`; `SheetContent` uses it; export list matches the original symbols exactly. ✓
