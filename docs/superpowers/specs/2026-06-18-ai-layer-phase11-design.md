# Phase 11 — AI Layer (Brain-equivalent) — Design Spec

> **Status:** Design approved 2026-06-18. Supersedes the high-level BUILD_PLAN §Phase 11 outline.
> **Build order:** This is the FIRST phase with no pre-written spec/plan. Phases 6→10 are
> code-complete (HEAD `ba58459`, local Docker `ProjectFlow_Test` at migration `0062`, 392 SP files).
> **Scope ceiling (locked):** BUILD_PLAN AI features **1–5**. Stretch agents (#6) are deferred to a
> Phase 11 follow-up.

---

## 0. Summary

Phase 11 adds an **AI layer over the workspace graph** — not a bolted-on chatbot. It rests on two
new, pluggable, deterministically-fakeable services in `apps/api`:

1. **`AiGatewayService`** — one provider-agnostic LLM interface (`complete`, `completeStructured`,
   `stream`) with a deterministic **FakeProvider** (default + all automated tests) and an
   **AnthropicProvider** (real, env-keyed). Every call is audited in `AiRuns` for metering.
2. **`RetrievalService`** — SQL-resident **hybrid** search (Full-Text keyword + embedding cosine)
   over a new `AiChunks` index, **permission-filtered** so a user only ever retrieves what they can
   `VIEW`. Embeddings via an `Embedder` interface (**FakeEmbedder** default/tests, **VoyageEmbedder**
   real, env-keyed).

An `ai-index.worker.ts` (BullMQ; structural twin of `recurrence.worker`/`scheduled-report.worker`)
keeps `AiChunks` in sync with tasks/docs/comments via the existing event seams.

The phase is delivered as **one spec → six implementation slices (11a–11f)**, matching the Phase 9
(9a–9f) granularity and the established per-slice DoD.

**The non-negotiable invariant:** *the AI layer never surfaces content the requesting user cannot
see.* This is enforced by reusing the existing, 10-phase-hardened `accessService.can` as the
**authoritative** gate (defense in depth, §4.3), and is tested hard in every relevant slice (§7).

---

## 1. Decisions locked in brainstorming (2026-06-18)

| # | Decision | Rationale |
|---|---|---|
| D1 | **Scope = features 1–5**, defer stretch agents (#6) | Agents carry the most runtime/safety surface (constrained tool execution + human-approval gate); not worth the risk in the first AI slice. |
| D2 | **Retrieval = SQL-resident hybrid** (FTS + embeddings in SQL, ACL JOIN) | Permission filtering stays native (a JOIN to the existing resolver, no over-fetch guesswork); no new service/container; deterministic local-Docker tests. The BUILD_PLAN's `pgvector`/Postgres assumption does not apply — this project is SQL Server (Standard in prod, no native `VECTOR` type). |
| D3 | **Provider-agnostic gateway; Fake in tests, Claude+Voyage real behind env keys** | Automated tests stay deterministic + cost-free (assert plumbing/permission-filtering/citations, not model quality). Real AI is a config flip (`ANTHROPIC_API_KEY` / `VOYAGE_API_KEY`). Anthropic has no first-party embeddings API → Voyage is the recommended pairing. |
| D4 | **Default real model `claude-opus-4-8`** + adaptive thinking, env-overridable (`AI_MODEL`) | Per the claude-api skill default; product keeps it configurable since the gateway is provider-agnostic. |
| D5 | **One spec, six slices 11a–11f** | Mirrors Phase 9 granularity + the per-slice review/merge DoD. |

---

## 2. Architecture

```
                         ┌─────────────────────────────────────────┐
   task/doc/comment      │  ai-index.worker (BullMQ, debounced)      │
   create/update/delete ─┼─▶ chunk → hash(skip-if-unchanged) →       │
   (existing event seams)│   embed(Embedder) → upsert AiChunks       │
                         └─────────────────────────────────────────┘
                                          │ writes
                                          ▼
   ┌──────────────┐   retrieve()   ┌──────────────┐   ACL JOIN + can() recheck
   │  AI features │ ─────────────▶ │ Retrieval    │ ─────────────────────────┐
   │ (11b–11f)    │                │ Service      │                          ▼
   │  REST + GQL  │   complete/    │ (hybrid)     │              usp_AccessibleScopes_ForUser
   │  gate ai.use │   structured/  └──────────────┘              + accessService.can (authoritative)
   └──────┬───────┘   stream()
          │             ┌──────────────┐
          └───────────▶ │ AiGateway    │── FakeProvider (default/tests)
                        │ Service      │── AnthropicProvider (@anthropic-ai/sdk, env-keyed)
                        └──────┬───────┘
                               │ audit
                               ▼
                            AiRuns (metering/observability)
```

**Module layout** (`apps/api/src/modules/ai/`):
- `gateway/` — `ai-gateway.service.ts`, `providers/fake.provider.ts`, `providers/anthropic.provider.ts`, `provider.types.ts`
- `retrieval/` — `retrieval.service.ts`, `embedder/fake.embedder.ts`, `embedder/voyage.embedder.ts`, `embedder.types.ts`, `chunk.ts` (pure chunker), `fusion.ts` (pure reciprocal-rank fusion)
- `index/` — `ai-index.worker.ts`, `ai-index.service.ts` (enqueue helpers wired into the existing services), `index.repository.ts`
- per-feature: `qa/` (11b), `fields/` (11c), `standup/` (11d), `nl-automation/` (11e), `writer/` (11f)
- `ai.repository.ts`, `ai.routes.ts` (REST primary), `graphql/ai.schema.ts` (Pothos mirror)

**Frontend** (`apps/next-web/src/`): an "Ask AI" command-bar/panel (11b), `FieldManager` `ai_field`
support + in-task cell (11c), inbox stand-up surface (11d), "Describe in words" entry in the
automation builder (11e), AI-writer affordances in the TipTap editor / task / comments (11f).
i18n lives at `apps/next-web/messages/` (en + id, parity — NOT `src/messages/`).

---

## 3. Data model

### 3.1 Migrations
- **`0063_ai_layer.sql`** — `AiChunks`, `AiRuns`, full-text catalog + index. Reversible + idempotent.
- **`0064_ai_perms.sql`** — seeds the **`ai.use`** permission slug into `Permissions` +
  `RolePermissions` (owner/admin/member; viewer excluded). DML only, no new SP.
  > **Why a perms migration:** every slice since 8b has been bitten by an unseeded slug fail-closing
  > a `requirePermission` gate — 403-ing even the workspace owner. Seed it up front.

Local Docker `ProjectFlow_Test` will advance to **0064** during 11a. (DB only ever runs on local
Docker — never prod. See the safe-local-DB pattern carried from every prior slice.)

### 3.2 `AiChunks`
One row per indexed text chunk.

| Column | Type | Notes |
|---|---|---|
| `Id` | UNIQUEIDENTIFIER PK | |
| `WorkspaceId` | UNIQUEIDENTIFIER NOT NULL | tenant scope (every query filters on it) |
| `ObjectType` | NVARCHAR(20) NOT NULL | `task` \| `doc` \| `comment` (CHECK) |
| `ObjectId` | UNIQUEIDENTIFIER NOT NULL | the source object |
| `ScopeType` | NVARCHAR(10) NOT NULL | `SPACE` \| `FOLDER` \| `LIST` — the ACL anchor node type |
| `ScopeId` | UNIQUEIDENTIFIER NOT NULL | the ACL anchor node id |
| `ListId` | UNIQUEIDENTIFIER NULL | containing List for tasks/comments (fast ACL join key) |
| `ChunkSeq` | INT NOT NULL | chunk ordinal within the object |
| `Content` | NVARCHAR(MAX) NOT NULL | chunk text; **FULL-TEXT indexed** |
| `Embedding` | VARBINARY(MAX) NULL | float32[] little-endian; NULL when embedder unavailable |
| `EmbeddingModel` | NVARCHAR(60) NULL | e.g. `fake-1` / `voyage-3` |
| `ContentHash` | CHAR(64) NOT NULL | SHA-256 of `Content`; skip re-embed if unchanged |
| `TokenCount` | INT NOT NULL | approximate; for budgeting |
| `CreatedAt`/`UpdatedAt` | DATETIME2 | |
| `DeletedAt` | DATETIME2 NULL | soft delete (on source delete) |

Indexes: `IX_AiChunks_Object (WorkspaceId, ObjectType, ObjectId)`,
`IX_AiChunks_Scope (WorkspaceId, ScopeType, ScopeId)`,
`IX_AiChunks_List (WorkspaceId, ListId)`; full-text index on `Content`
(unique key = `Id`). Embedding cosine is brute-force over the workspace-scoped, ACL-filtered
candidate set (acceptable at per-workspace corpus sizes; ANN deferred — §8).

### 3.3 `AiRuns`
Gateway audit + metering. Mirrors `AutomationRuns`.

`Id, WorkspaceId NOT NULL, UserId NOT NULL, Feature (qa|ai_field|standup|nl_automation|writer),
Provider, Model, Status (ok|error|refused), PromptTokens, CompletionTokens, LatencyMs, Error NVARCHAR(MAX) NULL, CreatedAt`.

### 3.4 AI Fields — reuse existing tables
The `ai_field` custom-field type was stubbed in Phase 2. 11c **reuses** `custom_fields`
(`type='ai_field'`, `config = { subtype, sourceField?, prompt? }`) and
`task_custom_field_values` (`value` JSON holds `{ output, subtype, computedAt, stale }`). **No new
field table.** Validation: extend the Phase-2 field-type Zod enum + value validator with `ai_field`.

---

## 4. Retrieval & permission filtering

### 4.1 `RetrievalService.retrieve(userId, workspaceId, query, opts)`
`opts = { scope?: {type,id}, k?: number, kind?: ('task'|'doc'|'comment')[] }`. Returns
`RetrievedChunk[] = { objectType, objectId, scopeType, scopeId, content, score }`, already
permission-filtered and ranked.

Steps:
1. **Keyword candidates** — SQL Full-Text (`CONTAINS`/`FREETEXT`) over `AiChunks.Content`, scoped to
   `WorkspaceId` (+ optional `scope` subtree), top-N.
2. **Semantic candidates** — `embedder.embed(query)` → brute-force cosine over the same
   workspace-scoped, ACL-filtered candidate set, top-N. Skipped gracefully if no `Embedding` rows
   (FakeEmbedder always produces them; Voyage only when keyed).
3. **Fusion** — pure `fusion.ts` reciprocal-rank fusion merges the two lists into a single ranked set.
4. **Authoritative re-check** — top-K survivors re-verified via `accessService.can` (§4.3).

### 4.2 Set-based pre-filter (the native JOIN — D2)
New read-only SP **`usp_AccessibleScopes_ForUser(@UserId, @WorkspaceId)`** returns the set of
`(ScopeType, ScopeId)` the user can `VIEW`, derived from the **exact same logic** as
`usp_ObjectAccess_Resolve`: role floor + most-specific `ObjectPermissions` + hierarchy `Path`
ancestry + **guest no-floor** (a guest/limited-member has NULL floor — Phase 10d). Candidate SQL
(both keyword + semantic) JOINs to / filters by this set, so disallowed chunks **never rank**.

> This SP mirrors resolver semantics and is the security-critical surface — it gets the heaviest
> review. But it is an **optimization**, not the gate; see §4.3.

### 4.3 Authoritative per-result re-check (defense in depth)
The small top-K result set is re-verified with the existing
`accessService.can(userId, scopeType, scopeId, 'VIEW')` — the *same proven gate every other module
uses*. A result is dropped unless `can()` passes. **This re-check is authoritative:** even if
`usp_AccessibleScopes_ForUser` had a bug, nothing leaks. The JOIN is the fast path; `can()` is the
safety net. The AI layer therefore **inherits** the ACL hardened across 10 phases (incl. guests'
no-floor) rather than introducing a parallel ACL.

**Citations are derived only from retrieved (already-filtered) chunks** — a citation can never point
at something the user cannot see.

### 4.4 Indexing pipeline
`ai-index.worker.ts` (BullMQ, debounced) consumes index jobs enqueued from the existing seams:
`task.service`, `docs.service`, `comment.service` on create/update/delete + soft-delete. For each
job: resolve the ACL anchor (`ScopeType`/`ScopeId`/`ListId`), run the pure `chunk.ts` chunker, hash
each chunk (skip re-embed when `ContentHash` unchanged), `embed`, upsert `AiChunks`; on delete,
soft-delete the object's chunks. Fully off the request path. A dev-only
`POST /api/v1/dev/ai/reindex` (NODE_ENV!=='production' guard, 404 in prod) backs e2e seeding —
same pattern as the automation-sweep / scheduled-report-sweep dev hooks.

---

## 5. AI gateway

### 5.1 Interface (`provider.types.ts`)
```ts
interface AiProvider {
  complete(req: CompleteRequest): Promise<CompleteResult>;            // single-shot text
  completeStructured<T>(req: StructuredRequest<T>): Promise<T>;       // schema-constrained
  stream(req: CompleteRequest): AsyncIterable<StreamChunk>;           // token stream (writer)
}
```
`AiGatewayService` wraps the active provider, records an `AiRuns` row per call (tokens, latency,
status), and is the single chokepoint all features call.

### 5.2 FakeProvider (default + all automated tests)
Deterministic. `complete` returns a stable string derived from the prompt — critically, it **echoes
the ids of any retrieved sources present in the prompt** so citation/permission assertions are
exact. `completeStructured` returns a canned object that satisfies the requested schema (e.g. a
valid `ruleShapeSchema` rule for 11e). `stream` yields the `complete` output in chunks. No network.

### 5.3 AnthropicProvider (real, env-keyed)
`@anthropic-ai/sdk`. Model `claude-opus-4-8` (overridable via `AI_MODEL`), `thinking:{type:'adaptive'}`.
`completeStructured` uses `output_config.format` / `messages.parse()`. `stream` uses `.stream()` +
`.finalMessage()`. Activated only when `ANTHROPIC_API_KEY` is set; otherwise the gateway uses
FakeProvider. Anthropic API is zero-retention by default (no training on tenant data) — satisfies
the plan's contractual requirement.

### 5.4 Embedder (`embedder.types.ts`)
`embed(texts: string[]): Promise<Float32Array[]>`. **FakeEmbedder** = deterministic hash → fixed-dim
vector (stable, no network; backs tests). **VoyageEmbedder** = raw HTTP (`fetch`) to Voyage
(non-Anthropic, so no SDK), env-keyed `VOYAGE_API_KEY`, model `voyage-3` (configurable).

---

## 6. Per-feature designs (slices)

### 11a — Foundation
Gateway (Fake+Anthropic) · Embedder (Fake+Voyage) · `AiChunks`+FTS + `AiRuns` (migration 0063) ·
`ai.use` perm (0064) · indexing worker + enqueue wiring into task/doc/comment services ·
`RetrievalService` (hybrid + two-layer permission filter) · `usp_AccessibleScopes_ForUser` ·
dev reindex endpoint. **User-facing surface:** an internal, `ai.use`-gated
`POST /ai/search` (returns permission-filtered `RetrievedChunk[]`) — enough to prove retrieval +
the security test, no LLM answer yet.
**Acceptance:** hybrid retrieval returns relevant chunks; a limited user's search **excludes**
chunks from spaces/tenants they can't see (the hard test); index worker upserts on
create/update + soft-deletes on delete; reversible/idempotent migrations.

### 11b — AI Q&A / Knowledge search (#1) — headline
`POST /ai/ask` (REST) + `aiAsk` (GraphQL), gate `ai.use`. Flow: `retrieve` (permission-scoped) →
numbered-source context prompt → `gateway.complete` → `{ answer, citations[] }`. Stateless (no
multi-turn memory v1). UI: "Ask AI" command-bar/panel with clickable source links.
**Acceptance (BUILD_PLAN):** *"What's at risk in the Marketing space this week?"* returns an answer
citing real tasks the user is allowed to see **and excludes tasks they can't**; citations resolve to
real objects.

### 11c — Summarization + AI Fields (#2)
`ai_field` type (subtypes: summary | sentiment | translate | action_items | categorize | custom)
computed via `gateway.completeStructured(subtypeSchema)`; value+meta stored in the existing field
value JSON; recompute as a debounced sibling job on task change + on-demand. On-demand
`POST /ai/summarize` for a task thread / doc / inbox. `FieldManager` exposes the type + subtype
picker; in-task cell renders value + "regenerate".
**Acceptance:** a task-thread summary and an `ai_field` (e.g. sentiment) populate correctly and
validate per subtype.

### 11d — AI stand-ups (#3)
Scheduled BullMQ worker (twin of `scheduled-report.worker`): per opted-in user, pull **their own
VIEW-able** activity (Phase-9e `usp_AuditLog_List`, permission-scoped) + open/blocked tasks →
`gateway.complete` → deliver an `AI_STANDUP` inbox notification. On-demand `GET /ai/standup`.
A stand-up only ever summarizes what that user can see (no cross-user data).
**Acceptance:** an on-demand stand-up compiles the user's recent activity + blockers; the scheduled
path delivers to the inbox on cadence.

### 11e — Natural-language automation builder (#4)
`POST /ai/automations/draft`: sentence → `gateway.completeStructured(ruleShapeSchema)` — the **exact
Zod schema** Phase 6 uses for automation create (`automation.templates.schema.ts`) — returns a
**preview** (not saved). User reviews in the existing builder, then saves via the existing
`automation create` path (re-validates + gates). Builder gains a "Describe in words" entry.
**Acceptance:** a sentence produces a valid, previewable automation that, once saved, runs.

### 11f — AI writer (#5)
`POST /ai/write` (streaming, SSE) `{ mode: generate|edit|improve, context, selection? }` →
`gateway.stream`. Wired into the TipTap doc editor (Phase 7a), task description, and comments:
generate at cursor; edit/improve a selection (insert vs replace).
**Acceptance:** streaming generation/edit works in a doc and a task; output respects the selection.

---

## 7. Testing strategy

All verification runs live on local Docker `ProjectFlow_Test`, deterministically (FakeProvider +
FakeEmbedder — no network, no cost, no flake).

- **The security test (the hard one), run in every relevant slice (11a/11b/11c/11d):** seed objects
  across **two tenants** AND a **restricted private Space**; index all; then ask / search /
  summarize / stand-up as a **limited user** and assert the disallowed content appears in
  **neither retrieval nor the answer/citations**. This is the BUILD_PLAN's *"test this hard"*
  requirement, realized as automated cross-tenant + intra-tenant negative tests.
- **FakeProvider determinism:** echoes retrieved source ids → citation assertions are exact;
  `completeStructured` returns schema-valid canned objects → 11e/11c structure assertions are exact.
- **Per slice (same DoD as 6–10):** API unit + integration (incl. cross-tenant negative-authz),
  web unit + en/id i18n parity, `apps/api` tsc + Next build clean, one Playwright e2e for the
  headline flow, reversible+idempotent migrations, DECISIONS.md entry. Stop for review/merge before
  the next slice. Final opus whole-slice review per slice (it has caught the headline cross-tenant
  hole every prior phase).

---

## 8. Deferred / out of scope (v1)

Documented here and to be re-stated in DECISIONS.md:
- **Stretch agents (#6)** — assignable mentionable agent-user with constrained tool execution +
  human-approval gate. Phase 11 follow-up.
- **Cross-encoder reranking** — fusion is reciprocal-rank only in v1.
- **ANN vector index** — brute-force cosine over the ACL-filtered candidate set for v1; revisit if
  per-workspace corpus sizes grow.
- **Multi-turn Q&A memory** — Q&A is single-shot in v1.
- **Real-time (vs debounced) index consistency** — eventual consistency via the debounced worker is
  acceptable.
- **Real-provider record/replay tests** — automated tests use the Fake only; real Claude/Voyage is
  manual/opt-in via env keys.

---

## 9. Build process (carried from every prior slice)

Per slice: **reconciliation Explore agent FIRST** (this spec predates the built code at execution
time; migration numbers / helper signatures / seams may have drifted — verify against the real
files, not an agent summary) → batch the plan's tasks by layer → one implementer subagent per batch
(controller writes ALL SQL + runs ALL DB + the e2e; subagents never touch the DB and hit GateGuard
on first-touch files) → per-batch spec+quality reviewer (opus on authz/SQL-heavy batches) →
controller commits per the plan's messages → **final opus whole-slice review (do NOT skip)** →
ff-merge to main locally, stop for review.

Safe local-DB env prefix (never prod):
```
$env:DB_SERVER='localhost'; $env:DB_PORT='1433'; $env:DB_NAME='ProjectFlow_Test'; $env:DB_USER='sa'; $env:DB_PASSWORD='YourStrong@Passw0rd'; $env:DB_ENCRYPT='false'; $env:DB_TRUST_SERVER_CERTIFICATE='true'; $env:REDIS_HOST='localhost'; $env:REDIS_PORT='6379'; $env:REDIS_URL='redis://localhost:6379'
```
