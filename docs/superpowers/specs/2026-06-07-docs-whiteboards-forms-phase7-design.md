# Phase 7 — Docs · Wikis · Whiteboards · Forms (Design)

**Date:** 2026-06-07
**Status:** Approved (design); spec under review
**BUILD_PLAN reference:** §Phase 7 ("Connected knowledge + intake surfaces")
**Prerequisite:** Phases 1–6 complete. Reuses Phase 4 comments (inline doc comments), Phase 5d
`template.service` (form-submission task templates), and the Phase 3.5c Redis presence pattern.

---

## 1. Overview & the real starting point

Phase 7 is **greenfield** — the opposite of Phase 6. There is **no existing implementation**: no
docs/wiki/whiteboard/forms modules in `apps/api`, no pages in `apps/next-web`, no tables in
migrations `0001–0037` (or 6's `0038–0039`). (The `projectflow/` directory that contains TipTap is a
**separate legacy scaffold** — the live app is the top-level `apps/api` + `apps/next-web`.)

Two facts shape the whole phase:
- **No rich-text foundation.** The live web app has no editor (no TipTap/ProseMirror/Slate/Lexical);
  task descriptions are plain. A Docs editor starts from zero.
- **Realtime is SSE-only.** The app uses `graphql-sse` + `graphql-yoga` (server→client push), Redis,
  BullMQ, S3 attachments. There is **no WebSocket layer and no Yjs/CRDT anywhere.**

The BUILD_PLAN requires **Yjs CRDT co-editing** for Docs and Whiteboards (live cursors, offline
merge). CRDT needs **bidirectional WebSocket** sync the app doesn't have — so the defining work of
this phase is **standing up a new realtime collaboration channel** alongside the existing SSE one.

### Locked product decisions (from brainstorming)
- **Scope:** **all four** subsystems (full BUILD_PLAN Phase 7).
- **Collaboration depth:** **full Yjs CRDT** co-editing (not autosave-only).
- **Whiteboard rendering:** **tldraw** (embeddable), bound to the same Yjs channel.

### Slices

| Slice | Feature | Notes |
|------|---------|-------|
| **7a** | Collaboration foundation + **Docs & Wikis** | Builds the shared Yjs collab server; the keystone |
| **7b** | **Whiteboards** (tldraw + Yjs) | Reuses 7a's collab server |
| **7c** | **Forms** (builder + conditional logic + submission→task) | Independent of the CRDT stack |

---

## 2. Architecture — the CRDT collaboration channel (the new spine)

Co-editing needs bidirectional sync the app lacks. This is the decisive fork.

**Chosen: a Hocuspocus Yjs WebSocket server, one channel for both Docs and Whiteboards.**

- **Collab server — Hocuspocus** (`@hocuspocus/server`). A Node WebSocket server for Yjs by the
  TipTap team, with the hooks we need:
  - `onAuthenticate` — validate the existing **JWT access token** + check object ACL
    (`requireObjectLevel('DOC'|'WHITEBOARD', id, 'EDIT'|'VIEW')`). Fail-closed.
  - `onLoadDocument` / `onStoreDocument` (debounced) — Yjs persistence (below).
  - native **awareness** — live cursors / presence for free.
  - **`@hocuspocus/extension-redis`** — multi-instance fan-out over the **existing Redis**.
  - **Both Docs (`y-prosemirror`) and Whiteboards (tldraw's Yjs binding) ride this one server** — one
    auth path, one persistence path, one scaling story.
  - *Rejected:* **y-websocket** (DIY auth/persistence), **tldraw-sync** (a second canvas-only backend
    that splits infra). ❌
- **Yjs persistence — SQL Server `VARBINARY(MAX)`.** Store the Yjs binary state per doc-page /
  whiteboard transactionally in the DB. Also write a rendered **ProseMirror / tldraw JSON snapshot**
  to `NVARCHAR(MAX)` on each debounced store — this powers **SSR first-paint** and **search/AI
  indexing** (Phase 11). Periodic snapshots into a versions table power **history/restore**.
  *Rejected:* S3 (non-transactional; attachments already cover blobs) and Redis-only (not durable). ❌
- **Topology.** A dedicated `collab` module attached to the HTTP server's WebSocket **upgrade**
  handler in dev, runnable as a **separate bootstrapped process** in prod (like the BullMQ workers),
  Redis-backed. Keeps WS concerns isolated from the HTTP/SSE/GraphQL server. SSR renders the JSON
  snapshot; the client editor hydrates, then connects to Yjs (`@hocuspocus/provider`) for live sync.

**New dependencies:** `yjs`, `@tiptap/react` + `@tiptap/starter-kit` + `@tiptap/extension-collaboration`
+ `@tiptap/extension-collaboration-cursor`, `y-prosemirror`, `@hocuspocus/server` +
`@hocuspocus/provider` + `@hocuspocus/extension-redis`, `tldraw` + its Yjs binding.

---

## 3. Cross-cutting conventions (every slice)

- **DB / SQL Server:** SP-per-op (`CREATE OR ALTER`, `SET NOCOUNT ON`, TRY/CATCH/TRANSACTION,
  `SELECT *` of affected rows) in `infra/sql/procedures/`, deployed by `scripts/db-deploy-sps.ts`.
- **Migrations:** `0040_docs.sql`, `0041_whiteboards.sql`, `0042_forms.sql` — idempotent, GO-batched,
  each with a matching `infra/sql/migrations/rollback/00XX_*.down.sql`.
- **API dual surface:** Hono **REST** (primary) + **GraphQL** mirror over one shared service per
  module (`docs`, `whiteboards`, `forms`). The Yjs **sync** path is the WebSocket collab server,
  separate from REST/GraphQL (which handle metadata, tree ops, history, links, form config).
- **Authorization:** `requireObjectLevel` for hierarchy ACL (docs/whiteboards/forms are scoped
  objects) + `requirePermission` for RBAC. The collab server reuses the same JWT + ACL in
  `onAuthenticate`. Public form rendering is the **only** unauthenticated surface (scoped read token).
- **Shared types:** extend `packages/types/index.ts` (hand-written).
- **i18n:** all UI strings in `en.json` + `id.json` (real Indonesian); `messages.unit` parity stays green.
- **DB execution policy:** migrations / SP-deploy / integration / e2e run **ONLY against local Docker
  `ProjectFlow_Test`** — never the prod-pointing `apps/api/.env`.
- **⚠️ Next.js:** per `apps/next-web/AGENTS.md`, this Next.js has breaking changes — **read the in-repo
  `node_modules/next/dist/docs/` before writing web code.**
- **Definition of Done (per slice):** acceptance boxes pass; migration reversible; unit + integration
  tests; ≥1 Playwright e2e for the headline flow (incl. a **two-browser co-edit** e2e for 7a);
  `@projectflow/types` updated; a `DECISIONS.md` entry logs deviations. Then **stop for review/merge**.

---

## 4. Slice 7a — Collaboration foundation + Docs & Wikis (the keystone)

### 4.1 Collaboration server
- New `apps/api/src/modules/collab/` — Hocuspocus server with `onAuthenticate` (JWT + ACL),
  `onLoadDocument`/`onStoreDocument` (debounced Yjs persistence + JSON snapshot), awareness, and the
  Redis extension. Document name encodes type + id (`doc-page:<id>`, `whiteboard:<id>`) so one server
  serves both. Bootstrapped at server start (in-process WS upgrade for dev; separable for prod).

### 4.2 Data model (`0040_docs.sql`)
```
Docs(Id PK, WorkspaceId, ScopeType, ScopeId, Name, Icon, IsWiki BIT, VerifiedById NULL,
     CreatedById, CreatedAt, UpdatedAt, DeletedAt)
DocPages(Id PK, DocId, ParentPageId NULL, Title, Icon, Cover NULL,
     Position FLOAT,                       -- fractional index
     BodyYjs VARBINARY(MAX) NULL,          -- live Yjs state
     BodyJson NVARCHAR(MAX) NULL,          -- rendered ProseMirror JSON (SSR + search)
     CreatedAt, UpdatedAt, DeletedAt)
DocPageVersions(Id PK, PageId, Snapshot NVARCHAR(MAX), CreatedById, CreatedAt)
DocTaskLinks(Id PK, DocPageId, TaskId, Kind NVARCHAR(20))   -- 'reference' | 'embed'
```

### 4.3 Backend
- Doc + page CRUD; **move/reorder** pages (fractional `Position`, nested tree via `ParentPageId`);
  **history**: list `DocPageVersions` + restore (writes a version, replaces current Yjs/JSON);
  doc↔task **links**; **create-task-from-selection** (creates a task + a `DocTaskLinks` row);
  **wiki flag** + verification/owner. REST + GraphQL mirror. SSR reads `BodyJson`.

### 4.4 Frontend
- **TipTap editor** client component with `Collaboration` + `CollaborationCursor` over
  `@hocuspocus/provider`; slash commands; **inline comments** (reuse Phase 4 comments anchored to a
  mark); **embed task/view** node (renders a live card). Nested **page-tree** sidebar (create/rename/
  drag-move). **Page history** panel with restore. "Mark as wiki" toggle + verified badge.

### 4.5 Tests
- **Unit:** fractional reorder math; snapshot/version builders; wiki-flag resolution.
- **Integration:** page CRUD + nested move; history restore; create-task-from-doc; wiki flag set/read.
- **e2e:** **two browsers co-edit a page with live cursors; an offline edit merges on reconnect**;
  history restores a prior version.

### 4.6 Acceptance (BUILD_PLAN)
- [ ] Two users co-edit a Doc with live cursors; offline edits merge via CRDT on reconnect.
- [ ] Page history restores a prior version.
- [ ] Doc marked as wiki is flagged and retrievable as such.

---

## 5. Slice 7b — Whiteboards (tldraw + Yjs)

### 5.1 Data model (`0041_whiteboards.sql`)
```
Whiteboards(Id PK, WorkspaceId, ScopeType, ScopeId, Name,
     DocYjs VARBINARY(MAX) NULL, DocJson NVARCHAR(MAX) NULL,   -- tldraw snapshot
     CreatedById, CreatedAt, UpdatedAt, DeletedAt)
```

### 5.2 Backend
- Whiteboard CRUD (metadata + persisted snapshot via the **same collab server**, doc name
  `whiteboard:<id>`). **Convert shape/sticky/text → task**: an endpoint that creates a task in a
  target list with the title from the shape's text and links it back. REST + GraphQL mirror.

### 5.3 Frontend
- **tldraw** canvas bound to Yjs (its binding) over the shared `@hocuspocus/provider`. A
  **convert-to-task** action on a selected shape (target-list picker). **Embed live task/doc cards**
  as custom tldraw shapes.

### 5.4 Tests
- **Unit:** shape→task title extraction; snapshot persistence shape.
- **Integration:** convert a sticky → task created in the chosen list + linked.
- **e2e:** a whiteboard sticky converts into a real task; two-browser co-edit syncs.

### 5.5 Acceptance (BUILD_PLAN)
- [ ] A whiteboard sticky converts into a real task in the chosen list.

---

## 6. Slice 7c — Forms (intake)

### 6.1 Data model (`0042_forms.sql`)
```
Forms(Id PK, WorkspaceId, ScopeType, ScopeId, Name,
     Config NVARCHAR(MAX),          -- fields[] + branching rules
     TargetListId, FieldMapping NVARCHAR(MAX),  -- form field -> task field/custom field
     TemplateId NULL,               -- optional Phase 5d task template applied on submit
     IsPublic BIT, PublicSlug NVARCHAR(64) NULL, AuthRequired BIT,
     CreatedById, CreatedAt, UpdatedAt, DeletedAt)
FormSubmissions(Id PK, FormId, Answers NVARCHAR(MAX), CreatedTaskId NULL,
     SubmittedById NULL, SubmittedAt DATETIME2)
```

### 6.2 Backend
- Form CRUD (config + mapping + target list); **public render** endpoint by `PublicSlug` (scoped
  read token, optional `AuthRequired`); **submit** → validate against config + branching, **create a
  task** in `TargetListId` with `FieldMapping` (+ optional `template.service.apply`), record a
  `FormSubmissions` row. REST + GraphQL mirror; the public render/submit pair is the only
  unauthenticated surface.

### 6.3 Frontend
- **Form builder**: drag field types, configure **conditional show/hide branching** (rules over prior
  answers), set target list + field mapping + optional template. **Public renderer** (link + embeddable
  iframe) that evaluates branching client-side and posts the submission.

### 6.4 Tests
- **Unit:** branching evaluation (show/hide); field→task mapping.
- **Integration:** submit a form → task created in target list with mapped fields (+ template applied);
  auth-required form rejects anonymous submit.
- **e2e:** a form with conditional logic hides/shows questions and creates a task on submit.

### 6.5 Acceptance (BUILD_PLAN)
- [ ] A form with conditional logic hides/shows questions and creates a task on submit.

---

## 7. Execution model

Each slice via **subagent-driven-development** (fresh implementer per task + two-stage spec/quality
review), Phase 5/6 cadence. After a slice: verify on **local Docker `ProjectFlow_Test`** (API unit +
integration, web unit + i18n parity, `npm run build`, the slice's e2e — including the two-browser
co-edit for 7a/7b); record decisions in `DECISIONS.md`; **stop for review/merge** before the next.

Order: **7a → 7b → 7c.** 7a builds the collab server that 7b reuses; **7c (Forms) is independent of
the CRDT stack and can move earlier** if intake is more urgent than whiteboards.

---

## 8. Consolidated deferrals (logged for `DECISIONS.md`)
1. **Sharing:** doc/whiteboard **public share links** (read-only scoped tokens) align with **Phase 10**
   (sharing/guests); 7c ships only the public **form** surface this phase.
2. **AI/search:** full-text + vector indexing of docs/wikis is **Phase 11** (it reads `BodyJson`).
3. **Whiteboard templates** and a richer shape→task mapping beyond title: follow-up.
4. **Form hardening:** analytics, spam/captcha, rate-limiting beyond `AuthRequired` align with
   **Phase 12** (public API surface).
5. **Offline-first** PWA caching of docs beyond Yjs's in-session offline merge: out of scope.
6. **Prod WS topology:** the collab server runs in-process (WS upgrade) for dev; a dedicated prod
   process + load-balancer sticky/Redis-fanout hardening is an ops follow-up.
