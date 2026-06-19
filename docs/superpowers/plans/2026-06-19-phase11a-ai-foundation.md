# Phase 11a — AI Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the AI layer's two core services (gateway + retrieval), the `AiChunks`/`AiRuns` schema, the permission-filtered hybrid retrieval path, the indexing worker, and an internal `POST /ai/search` — enough to prove permission-safe retrieval with no LLM answer yet.

**Architecture:** A provider-agnostic `AiGatewayService` (FakeProvider default, AnthropicProvider env-keyed) audited in `AiRuns`; a `RetrievalService` doing SQL Full-Text + brute-force embedding cosine over `AiChunks`, pre-filtered by a new read-only SP `usp_AccessibleScopes_ForUser` and **authoritatively** re-checked via the existing `accessService.can`. A BullMQ `ai-index.worker` keeps `AiChunks` in sync via the existing task/doc/comment service seams.

**Tech Stack:** SQL Server (mssql `execSp`), Hono (REST), Pothos (GraphQL), BullMQ + Redis, Vitest, `@anthropic-ai/sdk`, Voyage via raw `fetch`.

**Spec:** `docs/superpowers/specs/2026-06-18-ai-layer-phase11-design.md` (§2–§5, §6 "11a", §7).

---

### Task 0: Reconciliation (MANDATORY FIRST — do not skip)

This plan was written against an Explore pass on 2026-06-19. Per spec §9 the built code may have drifted. Before writing any code, verify these exact facts and note deltas in the commit:

- [ ] **Step 1: Confirm migration head.** Highest file in `infra/sql/migrations/` is `0062_guests.sql`. If higher, renumber AI migrations to `<head+1>_ai_layer.sql` / `<head+2>_ai_perms.sql` and update every reference below.
- [ ] **Step 2: Confirm SP conventions.** `infra/sql/procedures/usp_ObjectAccess_Resolve.sql` exists, uses `CREATE OR ALTER PROCEDURE`, params `(@UserId, @ObjectType NVARCHAR(8), @ObjectId)`, returns `(Level, Found)`; guest roles are `workspace-guest` / `workspace-limited-member` (NULL floor). SPs are deployed by `npm run db:deploy-sps` (`scripts/db-deploy-sps.ts`), NOT inline in migrations.
- [ ] **Step 3: Confirm helper signatures.** `execSp`/`execSpOne` in `apps/api/src/shared/lib/sqlClient.ts` take `(spName, [{name,type,value}])`. `accessService.can(userId, objectType, objectId, min)` in `apps/api/src/modules/access/access.service.ts` returns `Promise<boolean>`.
- [ ] **Step 4: Confirm worker + seam patterns.** `recurrence.worker.ts` (Queue/Worker/`upsertJobScheduler`/`registerCloser`), worker bootstrap in `apps/api/src/server.ts` (guarded by `REDIS_URL||REDIS_HOST`), `debounceGate(key, ttl)` in `apps/api/src/modules/notifications/fanout.ts`, dev-route pattern in `apps/api/src/modules/automation/automation.dev.routes.ts`. Confirm `task.service.ts`/`comment.service.ts` emit side-effect events and that `docs.service.ts` does NOT (you will add a seam there).
- [ ] **Step 5: Confirm perms seeding pattern** in `infra/sql/migrations/0018_rbac.sql` (SeedPermissions CTE + `INSERT ... WHERE NOT EXISTS`); role slugs `workspace-owner`/`workspace-admin`/`workspace-member`/`workspace-viewer`. Confirm `requirePermission(slug, opts)` + `resolveWorkspace` in `apps/api/src/shared/middleware/permissions.middleware.ts`.
- [ ] **Step 6:** If any delta, fix the affected tasks below before proceeding. Commit nothing in this task.

---

## File Structure

```
apps/api/src/modules/ai/
  gateway/
    provider.types.ts          # AiProvider interface + request/result types
    fake.provider.ts           # deterministic; echoes retrieved source ids
    anthropic.provider.ts      # @anthropic-ai/sdk, env-keyed
    ai-gateway.service.ts      # active-provider wrapper + AiRuns audit
  retrieval/
    embedder.types.ts          # Embedder interface
    fake.embedder.ts           # deterministic hash → fixed-dim vector
    voyage.embedder.ts         # raw fetch, env-keyed
    chunk.ts                   # pure chunker (text → chunks)
    fusion.ts                  # pure reciprocal-rank fusion
    retrieval.service.ts       # hybrid + two-layer permission filter
  index/
    ai-index.queue.ts          # BullMQ queue + job type
    ai-index.worker.ts         # consumer + startAiIndexWorker()
    ai-index.service.ts        # enqueue helpers (called from seams)
    index.repository.ts        # AiChunks upsert/soft-delete + candidate SQL
  ai.repository.ts             # AiRuns insert; AccessibleScopes call
  ai.routes.ts                 # POST /ai/search (ai.use gated)
  ai.dev.routes.ts             # POST /dev/ai/reindex (NODE_ENV guard)
  __tests__/
    retrieval.security.integration.test.ts   # THE hard cross-tenant test
    retrieval.hybrid.integration.test.ts
    gateway.unit.test.ts
    fusion.unit.test.ts
    chunk.unit.test.ts
    index.worker.integration.test.ts

infra/sql/migrations/0063_ai_layer.sql
infra/sql/migrations/0064_ai_perms.sql
infra/sql/migrations/rollback/0063_ai_layer.down.sql
infra/sql/migrations/rollback/0064_ai_perms.down.sql
infra/sql/procedures/usp_AccessibleScopes_ForUser.sql

apps/api/src/server.ts          # mount routes + start worker
```

---

### Task 1: Migration `0063_ai_layer.sql` (AiChunks, AiRuns, full-text)

**Files:**
- Create: `infra/sql/migrations/0063_ai_layer.sql`
- Create: `infra/sql/migrations/rollback/0063_ai_layer.down.sql`

- [ ] **Step 1: Write the forward migration** (idempotent, `GO`-batched, mirroring `0062`/`0039`):

```sql
-- 0063_ai_layer.sql — AI layer: chunk index + gateway audit. Reversible/idempotent.

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'AiChunks')
BEGIN
    CREATE TABLE dbo.AiChunks (
        Id             UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_AiChunks PRIMARY KEY DEFAULT NEWID(),
        WorkspaceId    UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.Workspaces(Id),
        ObjectType     NVARCHAR(20)     NOT NULL,
        ObjectId       UNIQUEIDENTIFIER NOT NULL,
        ScopeType      NVARCHAR(10)     NOT NULL,
        ScopeId        UNIQUEIDENTIFIER NOT NULL,
        ListId         UNIQUEIDENTIFIER NULL,
        ChunkSeq       INT              NOT NULL,
        Content        NVARCHAR(MAX)    NOT NULL,
        Embedding      VARBINARY(MAX)   NULL,
        EmbeddingModel NVARCHAR(60)     NULL,
        ContentHash    CHAR(64)         NOT NULL,
        TokenCount     INT              NOT NULL,
        CreatedAt      DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
        UpdatedAt      DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
        DeletedAt      DATETIME2        NULL,
        CONSTRAINT CK_AiChunks_ObjectType CHECK (ObjectType IN ('task','doc','comment')),
        CONSTRAINT CK_AiChunks_ScopeType  CHECK (ScopeType  IN ('SPACE','FOLDER','LIST'))
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_AiChunks_Object')
    CREATE INDEX IX_AiChunks_Object ON dbo.AiChunks (WorkspaceId, ObjectType, ObjectId);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_AiChunks_Scope')
    CREATE INDEX IX_AiChunks_Scope ON dbo.AiChunks (WorkspaceId, ScopeType, ScopeId);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_AiChunks_List')
    CREATE INDEX IX_AiChunks_List ON dbo.AiChunks (WorkspaceId, ListId);
GO

-- Full-text: catalog + index keyed on the named PK (PK_AiChunks, so it is deterministic).
IF NOT EXISTS (SELECT 1 FROM sys.fulltext_catalogs WHERE name = 'ftAiChunks')
    CREATE FULLTEXT CATALOG ftAiChunks;
GO
IF NOT EXISTS (SELECT 1 FROM sys.fulltext_indexes i
               JOIN sys.tables t ON t.object_id = i.object_id WHERE t.name = 'AiChunks')
    CREATE FULLTEXT INDEX ON dbo.AiChunks (Content) KEY INDEX PK_AiChunks ON ftAiChunks;
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'AiRuns')
BEGIN
    CREATE TABLE dbo.AiRuns (
        Id               UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
        WorkspaceId      UNIQUEIDENTIFIER NOT NULL,
        UserId           UNIQUEIDENTIFIER NOT NULL,
        Feature          NVARCHAR(20)     NOT NULL,
        Provider         NVARCHAR(40)     NULL,
        Model            NVARCHAR(60)     NULL,
        Status           NVARCHAR(10)     NOT NULL,
        PromptTokens     INT              NULL,
        CompletionTokens INT              NULL,
        LatencyMs        INT              NULL,
        Error            NVARCHAR(MAX)    NULL,
        CreatedAt        DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT CK_AiRuns_Feature CHECK (Feature IN ('qa','ai_field','standup','nl_automation','writer','search')),
        CONSTRAINT CK_AiRuns_Status  CHECK (Status  IN ('ok','error','refused'))
    );
END
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_AiRuns_Workspace')
    CREATE INDEX IX_AiRuns_Workspace ON dbo.AiRuns (WorkspaceId, CreatedAt);
GO
```

- [ ] **Step 2: Write the rollback** `rollback/0063_ai_layer.down.sql`:

```sql
IF EXISTS (SELECT 1 FROM sys.fulltext_indexes i JOIN sys.tables t ON t.object_id=i.object_id WHERE t.name='AiChunks')
    DROP FULLTEXT INDEX ON dbo.AiChunks;
GO
IF EXISTS (SELECT 1 FROM sys.fulltext_catalogs WHERE name='ftAiChunks') DROP FULLTEXT CATALOG ftAiChunks;
GO
IF EXISTS (SELECT 1 FROM sys.tables WHERE name='AiChunks') DROP TABLE dbo.AiChunks;
GO
IF EXISTS (SELECT 1 FROM sys.tables WHERE name='AiRuns') DROP TABLE dbo.AiRuns;
GO
DELETE FROM dbo.MigrationHistory WHERE [FileName] = '0063_ai_layer.sql';
GO
```

- [ ] **Step 3: Run the migration against local Docker** (never prod — see spec §9 env prefix):

Run (PowerShell, prefixed with the safe-local-DB env from spec §9): `npm run db:migrate`
Expected: `0063_ai_layer.sql` applied; no error. **FTS risk:** if `CREATE FULLTEXT CATALOG` errors with "full-text search is not installed", the MSSQL Docker image lacks the FTS component — either rebuild the test container from an image with Full-Text, or temporarily degrade keyword candidates to `LIKE` in Task 7/8 and record the delta in DECISIONS.md (semantic path via FakeEmbedder still works).

- [ ] **Step 4: Commit.**

```bash
git add infra/sql/migrations/0063_ai_layer.sql infra/sql/migrations/rollback/0063_ai_layer.down.sql
git commit -m "feat(11a): 0063_ai_layer migration — AiChunks (FTS) + AiRuns audit"
```

---

### Task 2: Migration `0064_ai_perms.sql` (seed `ai.use`)

**Files:**
- Create: `infra/sql/migrations/0064_ai_perms.sql`
- Create: `infra/sql/migrations/rollback/0064_ai_perms.down.sql`

- [ ] **Step 1: Write the seed** (mirror `0018_rbac.sql` CTE pattern; owner/admin/member, NOT viewer):

```sql
-- 0064_ai_perms.sql — seed ai.use into Permissions + RolePermissions (DML only, no SP).
WITH SeedPermissions AS (
    SELECT 'ai' AS Resource, 'use' AS Action, 'ai.use' AS Slug, 'workspace' AS Scope,
           'Use AI features (search, ask, summarize, write)' AS Description
)
INSERT INTO dbo.Permissions (Resource, Action, Slug, Scope, Description)
SELECT s.Resource, s.Action, s.Slug, s.Scope, s.Description
FROM SeedPermissions s
WHERE NOT EXISTS (SELECT 1 FROM dbo.Permissions p WHERE p.Slug = s.Slug);
GO

WITH RolePermSeed AS (
    SELECT 'workspace-owner'  AS RoleSlug, 'ai.use' AS PermissionSlug
    UNION ALL SELECT 'workspace-admin',  'ai.use'
    UNION ALL SELECT 'workspace-member', 'ai.use'
)
INSERT INTO dbo.RolePermissions (RoleId, PermissionId)
SELECT r.Id, p.Id
FROM RolePermSeed s
JOIN dbo.Roles r       ON r.Slug = s.RoleSlug
JOIN dbo.Permissions p ON p.Slug = s.PermissionSlug
WHERE NOT EXISTS (
    SELECT 1 FROM dbo.RolePermissions rp WHERE rp.RoleId = r.Id AND rp.PermissionId = p.Id
);
GO
```

- [ ] **Step 2: Write rollback** `rollback/0064_ai_perms.down.sql`:

```sql
DELETE rp FROM dbo.RolePermissions rp
  JOIN dbo.Permissions p ON p.Id = rp.PermissionId WHERE p.Slug = 'ai.use';
GO
DELETE FROM dbo.Permissions WHERE Slug = 'ai.use';
GO
DELETE FROM dbo.MigrationHistory WHERE [FileName] = '0064_ai_perms.sql';
GO
```

- [ ] **Step 3: Run + verify.** Run: `npm run db:migrate` then assert `ai.use` exists in `Permissions` (1 row) + `RolePermissions` (3 rows). Expected: matches.

- [ ] **Step 4: Commit.**

```bash
git add infra/sql/migrations/0064_ai_perms.sql infra/sql/migrations/rollback/0064_ai_perms.down.sql
git commit -m "feat(11a): 0064_ai_perms migration — seed ai.use (owner/admin/member)"
```

---

### Task 3: `usp_AccessibleScopes_ForUser` (set-based ACL pre-filter)

**Files:**
- Create: `infra/sql/procedures/usp_AccessibleScopes_ForUser.sql`
- Test: `apps/api/src/modules/ai/__tests__/accessible-scopes.integration.test.ts`

This SP is the heaviest-review surface (spec §4.2). It mirrors `usp_ObjectAccess_Resolve` semantics (role floor + most-specific ObjectPermissions + Path ancestry + **guest no-floor**) but returns the SET of `(ScopeType, ScopeId)` the user can VIEW in a workspace.

- [ ] **Step 1: Write the failing integration test** (the SET semantics the JOIN depends on):

```ts
// accessible-scopes.integration.test.ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { execSp } from '../../../shared/lib/sqlClient.js';
import sql from 'mssql';
import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
import { closePool } from '../../../shared/lib/db.js';
// helper seedGuestScenario(): owner-created private Space A + List L1; guest granted VIEW on L1 only.

beforeEach(async () => { await truncateAll(); });
afterAll(async () => { await closePool(); });

it('guest sees ONLY explicitly-granted scopes (no role floor)', async () => {
  const f = await seedGuestScenario();
  const rows = await execSp<{ ScopeType: string; ScopeId: string }>(
    'usp_AccessibleScopes_ForUser',
    [{ name: 'UserId', type: sql.UniqueIdentifier, value: f.guestId },
     { name: 'WorkspaceId', type: sql.UniqueIdentifier, value: f.workspaceId }],
  );
  const ids = rows[0].map(r => r.ScopeId);
  expect(ids).toContain(f.list1Id);
  expect(ids).not.toContain(f.spaceAId);   // no floor → private space not visible
  expect(ids).not.toContain(f.list2Id);    // sibling not granted
});

it('regular member sees floor scopes (EDIT floor)', async () => { /* member sees non-private scopes */ });
```

- [ ] **Step 2: Run it — expect FAIL** (`Could not find stored procedure 'usp_AccessibleScopes_ForUser'`).

Run: `npx vitest run apps/api/src/modules/ai/__tests__/accessible-scopes.integration.test.ts`

- [ ] **Step 3: Write the SP** by porting `usp_ObjectAccess_Resolve` logic from per-object to per-set. Skeleton (replace table/column names + the ancestry join with the resolver's exact form, confirmed in Task 0):

```sql
CREATE OR ALTER PROCEDURE dbo.usp_AccessibleScopes_ForUser
    @UserId      UNIQUEIDENTIFIER,
    @WorkspaceId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;

    -- Role floor: owner/admin=FULL, member=EDIT, guest/limited-member=NULL (no floor), non-member=NULL.
    DECLARE @Floor NVARCHAR(8) = NULL;
    SELECT @Floor = CASE r.Slug
        WHEN 'workspace-owner'  THEN 'FULL'
        WHEN 'workspace-admin'  THEN 'FULL'
        WHEN 'workspace-member' THEN 'EDIT'
        ELSE NULL END
    FROM dbo.WorkspaceMembers wm JOIN dbo.Roles r ON r.Id = wm.RoleId
    WHERE wm.UserId = @UserId AND wm.WorkspaceId = @WorkspaceId;

    -- Candidate scope nodes in the workspace with their materialized Path.
    ;WITH Scopes AS (
        SELECT 'SPACE' AS ScopeType, s.Id AS ScopeId, '/' + CONVERT(NVARCHAR(36), s.Id) + '/' AS Path,
               s.IsPrivate AS IsPrivate
          FROM dbo.Spaces s WHERE s.WorkspaceId = @WorkspaceId AND s.DeletedAt IS NULL
        UNION ALL
        SELECT 'FOLDER', f.Id, f.Path, NULL FROM dbo.Folders f WHERE f.WorkspaceId = @WorkspaceId AND f.DeletedAt IS NULL
        UNION ALL
        SELECT 'LIST', l.Id, l.Path, NULL FROM dbo.Lists l WHERE l.WorkspaceId = @WorkspaceId AND l.DeletedAt IS NULL
    )
    SELECT sc.ScopeType, sc.ScopeId
    FROM Scopes sc
    OUTER APPLY (
        -- most-specific explicit grant on this node or any ancestor (USER beats ROLE; deepest beats shallow)
        SELECT TOP 1 op.Level
        FROM dbo.ObjectPermissions op
        WHERE op.WorkspaceId = @WorkspaceId
          AND sc.Path LIKE '%/' + CONVERT(NVARCHAR(36), op.ObjectId) + '/%'   -- ⚠ use the resolver's exact ancestry predicate
          AND ( (op.SubjectType='USER' AND op.SubjectId=@UserId)
             OR (op.SubjectType='ROLE' AND op.SubjectId IN
                   (SELECT RoleId FROM dbo.WorkspaceMembers WHERE UserId=@UserId AND WorkspaceId=@WorkspaceId)) )
        ORDER BY LEN(sc.Path) DESC, CASE op.SubjectType WHEN 'USER' THEN 0 ELSE 1 END
    ) grant
    -- visible if an explicit grant exists, OR a floor applies and the space is not private-without-grant
    WHERE COALESCE(grant.Level, @Floor) IS NOT NULL;
END
GO
```

> ⚠ The ancestry/private-space handling is security-critical. Port it **verbatim** from `usp_ObjectAccess_Resolve` rather than trusting this sketch — the resolver already encodes private-space + guest-no-floor + depth ordering correctly. The per-result `can()` re-check (Task 8) is the safety net, but this SP must be right for performance and to not over-return.

- [ ] **Step 4: Deploy + run — expect PASS.** Run: `npm run db:deploy-sps` then re-run the test. Expected: guest sees only L1; member sees floor scopes.

- [ ] **Step 5: Commit.**

```bash
git add infra/sql/procedures/usp_AccessibleScopes_ForUser.sql apps/api/src/modules/ai/__tests__/accessible-scopes.integration.test.ts
git commit -m "feat(11a): usp_AccessibleScopes_ForUser — set-based ACL pre-filter (mirrors resolver incl. guest no-floor)"
```

---

### Task 4: Pure modules — `chunk.ts` + `fusion.ts` (TDD, no DB)

**Files:**
- Create: `apps/api/src/modules/ai/retrieval/chunk.ts`, `retrieval/fusion.ts`
- Test: `apps/api/src/modules/ai/__tests__/chunk.unit.test.ts`, `fusion.unit.test.ts`

- [ ] **Step 1: Write `fusion` failing test.**

```ts
import { it, expect } from 'vitest';
import { reciprocalRankFusion } from '../retrieval/fusion.js';
it('fuses two ranked id-lists, rewarding agreement', () => {
  const fused = reciprocalRankFusion([['a','b','c'], ['b','d','a']], 60);
  expect(fused[0]).toBe('a'); // ranks high in both lists
  expect(fused).toContain('d');
});
```

- [ ] **Step 2: Run — FAIL.** `npx vitest run apps/api/src/modules/ai/__tests__/fusion.unit.test.ts`

- [ ] **Step 3: Implement `fusion.ts`:**

```ts
// Reciprocal-rank fusion. lists = arrays of ids ordered best→worst. Returns ids best→worst.
export function reciprocalRankFusion(lists: string[][], k = 60): string[] {
  const score = new Map<string, number>();
  for (const list of lists)
    list.forEach((id, i) => score.set(id, (score.get(id) ?? 0) + 1 / (k + i + 1)));
  return [...score.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}
```

- [ ] **Step 4: Run — PASS.**

- [ ] **Step 5: Write `chunk` failing test + implement.** Test: a 2000-word string yields >1 chunk, each `tokenCount <= 450`, seqs 0..n.

```ts
// chunk.ts
export interface Chunk { seq: number; content: string; tokenCount: number; }
const TARGET = 400, OVERLAP = 40;
const estTokens = (s: string) => Math.ceil(s.trim().split(/\s+/).filter(Boolean).length / 0.75);
export function chunkText(text: string): Chunk[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const perChunk = Math.ceil(TARGET * 0.75); // ~300 words ≈ 400 tokens
  const out: Chunk[] = [];
  for (let start = 0, seq = 0; start < words.length; start += perChunk - OVERLAP, seq++) {
    const slice = words.slice(start, start + perChunk).join(' ');
    out.push({ seq, content: slice, tokenCount: estTokens(slice) });
    if (start + perChunk >= words.length) break;
  }
  return out;
}
```

- [ ] **Step 6: Commit.**

```bash
git add apps/api/src/modules/ai/retrieval/chunk.ts apps/api/src/modules/ai/retrieval/fusion.ts apps/api/src/modules/ai/__tests__/chunk.unit.test.ts apps/api/src/modules/ai/__tests__/fusion.unit.test.ts
git commit -m "feat(11a): pure chunker + reciprocal-rank fusion (unit-tested)"
```

---

### Task 5: Embedder (Fake + Voyage)

**Files:**
- Create: `apps/api/src/modules/ai/retrieval/embedder.types.ts`, `fake.embedder.ts`, `voyage.embedder.ts`
- Test: `apps/api/src/modules/ai/__tests__/embedder.unit.test.ts`

- [ ] **Step 1: Define interface + failing test.**

```ts
// embedder.types.ts
export interface Embedder { readonly model: string; embed(texts: string[]): Promise<Float32Array[]>; }
```

```ts
// embedder.unit.test.ts
import { it, expect } from 'vitest';
import { FakeEmbedder } from '../retrieval/fake.embedder.js';
it('is deterministic and fixed-dim', async () => {
  const e = new FakeEmbedder();
  const [a] = await e.embed(['hello world']); const [b] = await e.embed(['hello world']);
  expect(Array.from(a)).toEqual(Array.from(b));
  expect(a.length).toBe(256);
});
```

- [ ] **Step 2: Run — FAIL. Step 3: Implement FakeEmbedder:**

```ts
// fake.embedder.ts
import { createHash } from 'node:crypto';
import type { Embedder } from './embedder.types.js';
const DIM = 256;
export class FakeEmbedder implements Embedder {
  readonly model = 'fake-1';
  async embed(texts: string[]): Promise<Float32Array[]> {
    return texts.map((t) => {
      const v = new Float32Array(DIM);
      for (const tok of t.toLowerCase().split(/\s+/).filter(Boolean)) {
        const h = createHash('sha256').update(tok).digest();
        for (let i = 0; i < DIM; i++) v[i] += (h[i % h.length] - 128) / 128;
      }
      let norm = 0; for (let i = 0; i < DIM; i++) norm += v[i] * v[i];
      norm = Math.sqrt(norm) || 1;
      for (let i = 0; i < DIM; i++) v[i] /= norm;
      return v;
    });
  }
}
```

- [ ] **Step 4: Run — PASS. Step 5: Implement VoyageEmbedder + factory** (raw fetch, env-keyed; no automated test — manual/opt-in per spec §8):

```ts
// voyage.embedder.ts
import type { Embedder } from './embedder.types.js';
import { FakeEmbedder } from './fake.embedder.js';
export class VoyageEmbedder implements Embedder {
  readonly model = process.env.VOYAGE_MODEL ?? 'voyage-3';
  async embed(texts: string[]): Promise<Float32Array[]> {
    const res = await fetch('https://api.voyageai.com/v1/embeddings', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.VOYAGE_API_KEY}` },
      body: JSON.stringify({ model: this.model, input: texts }),
    });
    if (!res.ok) throw new Error(`Voyage ${res.status}: ${await res.text()}`);
    const json = (await res.json()) as { data: { embedding: number[] }[] };
    return json.data.map((d) => Float32Array.from(d.embedding));
  }
}
export function makeEmbedder(): Embedder {
  return process.env.VOYAGE_API_KEY ? new VoyageEmbedder() : new FakeEmbedder();
}
```

- [ ] **Step 6: Commit.**

```bash
git add apps/api/src/modules/ai/retrieval/embedder.types.ts apps/api/src/modules/ai/retrieval/fake.embedder.ts apps/api/src/modules/ai/retrieval/voyage.embedder.ts apps/api/src/modules/ai/__tests__/embedder.unit.test.ts
git commit -m "feat(11a): Embedder (FakeEmbedder deterministic + VoyageEmbedder env-keyed)"
```

---

### Task 6: AI Gateway (provider interface + Fake + Anthropic + AiRuns audit)

**Files:**
- Create: `apps/api/src/modules/ai/gateway/provider.types.ts`, `fake.provider.ts`, `anthropic.provider.ts`, `ai-gateway.service.ts`
- Create: `apps/api/src/modules/ai/ai.repository.ts` (AiRuns insert)
- Modify: `apps/api/package.json` (add `@anthropic-ai/sdk`)
- Test: `apps/api/src/modules/ai/__tests__/gateway.unit.test.ts`

- [ ] **Step 1: Define types.**

```ts
// provider.types.ts
export type AiFeature = 'qa'|'ai_field'|'standup'|'nl_automation'|'writer'|'search';
export interface RetrievedSource { id: string; objectType: string; objectId: string; content: string; }
export interface CompleteRequest { prompt: string; system?: string; sources?: RetrievedSource[]; maxTokens?: number; }
export interface CompleteResult { text: string; promptTokens?: number; completionTokens?: number; }
export interface StructuredRequest<T> extends CompleteRequest { schemaName: string; jsonSchema: object; }
export interface StreamChunk { delta: string; }
export interface AiProvider {
  readonly name: string;
  complete(req: CompleteRequest): Promise<CompleteResult>;
  completeStructured<T>(req: StructuredRequest<T>): Promise<T>;
  stream(req: CompleteRequest): AsyncIterable<StreamChunk>;
}
```

- [ ] **Step 2: Write failing test — FakeProvider echoes source ids (citation hook):**

```ts
// gateway.unit.test.ts
import { it, expect } from 'vitest';
import { FakeProvider } from '../gateway/fake.provider.js';
it('echoes retrieved source ids so citation assertions are exact', async () => {
  const p = new FakeProvider();
  const r = await p.complete({ prompt: 'q', sources: [{ id: 'c1', objectType:'task', objectId:'t1', content:'x' }] });
  expect(r.text).toContain('c1');
});
```

- [ ] **Step 3: Run — FAIL. Step 4: Implement FakeProvider:**

```ts
// fake.provider.ts
import type { AiProvider, CompleteRequest, CompleteResult, StructuredRequest, StreamChunk } from './provider.types.js';
export class FakeProvider implements AiProvider {
  readonly name = 'fake';
  async complete(req: CompleteRequest): Promise<CompleteResult> {
    const ids = (req.sources ?? []).map(s => s.id).join(',');
    const text = `[fake answer] ${req.prompt.slice(0, 80)}${ids ? ` sources:${ids}` : ''}`;
    return { text, promptTokens: req.prompt.length, completionTokens: text.length };
  }
  async completeStructured<T>(req: StructuredRequest<T>): Promise<T> {
    // Default canned object echoes sources for citation tests; 11c/11e register schema-specific shapes.
    return ({ __fake: true, schema: req.schemaName, sources: (req.sources ?? []).map(s => s.id) } as unknown) as T;
  }
  async *stream(req: CompleteRequest): AsyncIterable<StreamChunk> {
    const { text } = await this.complete(req);
    for (const word of text.split(' ')) yield { delta: word + ' ' };
  }
}
```

- [ ] **Step 5: Implement AnthropicProvider.** ⚠ Before writing, consult the **claude-api skill** for the exact structured-output + streaming API (do not guess `output_config` / `messages.parse` / `.stream()` names). Model `claude-opus-4-8` default, `AI_MODEL` override, `thinking:{type:'adaptive'}`. Add `@anthropic-ai/sdk` to `apps/api/package.json`. No automated test (manual/opt-in).

- [ ] **Step 6: Implement `ai.repository.ts`** (`recordRun(row)` → insert into `AiRuns` via `execSp`/parameterized insert) + `ai-gateway.service.ts`:

```ts
// ai-gateway.service.ts (shape)
export class AiGatewayService {
  constructor(private provider = makeProvider(), private repo = new AiRepository()) {}
  async complete(ctx: { workspaceId: string; userId: string; feature: AiFeature }, req: CompleteRequest) {
    const start = Date.now();
    try {
      const r = await this.provider.complete(req);
      await this.repo.recordRun({ ...ctx, provider: this.provider.name, status: 'ok',
        promptTokens: r.promptTokens, completionTokens: r.completionTokens, latencyMs: Date.now() - start });
      return r;
    } catch (e: any) {
      await this.repo.recordRun({ ...ctx, provider: this.provider.name, status: 'error',
        latencyMs: Date.now() - start, error: e?.message });
      throw e;
    }
  }
  // completeStructured / stream wrap identically (stream records after the iterator drains)
}
```

`makeProvider()`: `ANTHROPIC_API_KEY` set ⇒ `AnthropicProvider`, else `FakeProvider`.

- [ ] **Step 7: Test the audit path** (integration) — `gateway.complete(ctx, req)` writes exactly one `AiRuns` row, `status='ok'`. Run gateway tests — expect PASS.

- [ ] **Step 8: Commit.**

```bash
git add apps/api/src/modules/ai/gateway apps/api/src/modules/ai/ai.repository.ts apps/api/src/modules/ai/__tests__/gateway.unit.test.ts apps/api/package.json
git commit -m "feat(11a): AiGatewayService — provider-agnostic (Fake+Anthropic) with AiRuns audit"
```

---

### Task 7: `index.repository.ts` + indexing service/worker + seams

**Files:**
- Create: `apps/api/src/modules/ai/index/index.repository.ts`, `ai-index.service.ts`, `ai-index.queue.ts`, `ai-index.worker.ts`
- Modify: `apps/api/src/modules/tasks/task.service.ts`, `.../comments/comment.service.ts`, `.../docs/docs.service.ts` (NEW seam), `apps/api/src/server.ts`
- Test: `apps/api/src/modules/ai/__tests__/index.worker.integration.test.ts`

- [ ] **Step 1: Write failing integration test** — enqueue an index job for a seeded task; run `runIndexJob(job.data)` directly; assert `AiChunks` rows with correct `ScopeType/ScopeId/ListId`; update changes `Content`+`ContentHash`; delete sets `DeletedAt`.

- [ ] **Step 2: Implement `index.repository.ts`** — `upsertChunks(rows)` (delete live chunks for the object, then insert fresh — ponytail: simplest correct upsert; switch to MERGE-by-hash only if re-index churn shows in profiling), `softDeleteByObject(workspaceId, objectType, objectId)`, and the two candidate queries: `keywordCandidates(workspaceId, query, userId, opts)` (`CONTAINS`/`FREETEXT`, JOINed to `usp_AccessibleScopes_ForUser`) and `semanticCandidates(workspaceId, qvec, userId, opts)` (load ACL-filtered rows' `Embedding`, cosine in JS), plus `loadChunks(workspaceId, ids)`.

- [ ] **Step 3: Implement `ai-index.queue.ts` + `ai-index.worker.ts`** mirroring `recurrence.worker.ts` (Queue, Worker, `registerCloser`; export `startAiIndexWorker()` and a directly-callable `runIndexJob(data)`). Job data: `{ workspaceId, objectType: 'task'|'doc'|'comment', objectId, op: 'upsert'|'delete' }`. `runIndexJob` resolves ACL anchor (`ScopeType/ScopeId/ListId`) for the object, fetches its text, `chunkText`, hashes each (skip re-embed when `ContentHash` unchanged vs existing row), `embed`, `upsertChunks`; `op:'delete'` ⇒ `softDeleteByObject`.

- [ ] **Step 4: Implement `ai-index.service.ts`** — `enqueueIndex(workspaceId, objectType, objectId)` / `enqueueDelete(...)`, guarded by `debounceGate('ai:index:'+objectType+':'+objectId, 30)` so rapid edits coalesce; fails open if Redis down.

- [ ] **Step 5: Wire seams.** In `task.service.ts` (create/update/delete) and `comment.service.ts` (create/update/delete), add `void aiIndexService.enqueueIndex(workspaceId, 'task'|'comment', id).catch(err => log.error(...))` (or `enqueueDelete`) alongside the existing `emitAutomationEvent` calls. In `docs.service.ts` (no side-effect jobs today) add the same on create/update/delete.

- [ ] **Step 6: Start the worker** in `server.ts` inside the `if (REDIS_URL||REDIS_HOST)` block:

```ts
startAiIndexWorker().catch((err) => logger.warn({ err: err?.message }, 'ai-index worker failed to start'));
```

- [ ] **Step 7: Run worker test — PASS.** `npx vitest run apps/api/src/modules/ai/__tests__/index.worker.integration.test.ts`

- [ ] **Step 8: Commit.**

```bash
git add apps/api/src/modules/ai/index apps/api/src/modules/tasks/task.service.ts apps/api/src/modules/comments/comment.service.ts apps/api/src/modules/docs/docs.service.ts apps/api/src/server.ts apps/api/src/modules/ai/__tests__/index.worker.integration.test.ts
git commit -m "feat(11a): ai-index worker + enqueue seams (task/comment/doc) + AiChunks upsert"
```

---

### Task 8: `RetrievalService` (hybrid + two-layer permission filter)

**Files:**
- Create: `apps/api/src/modules/ai/retrieval/retrieval.service.ts`
- Test: `apps/api/src/modules/ai/__tests__/retrieval.hybrid.integration.test.ts`

- [ ] **Step 1: Write failing hybrid test** — seed two docs: one keyword-only match, one semantically-near only; assert both appear in `retrieve()` (proves FTS+cosine fusion).

- [ ] **Step 2: Implement `retrieve(userId, workspaceId, query, opts)`** per spec §4.1:

```ts
async retrieve(userId: string, workspaceId: string, query: string,
               opts: { scope?: {type:string;id:string}; k?: number; kind?: string[] } = {}) {
  const k = opts.k ?? 8;
  const kw  = await this.indexRepo.keywordCandidates(workspaceId, query, userId, opts);   // ACL-JOINed
  const [qvec] = await this.embedder.embed([query]);
  const sem = await this.indexRepo.semanticCandidates(workspaceId, qvec, userId, opts);    // ACL-JOINed
  const fusedIds = reciprocalRankFusion([kw.map(r=>r.id), sem.map(r=>r.id)]).slice(0, k * 2);
  const chunks = await this.indexRepo.loadChunks(workspaceId, fusedIds);
  // AUTHORITATIVE per-result re-check (defense in depth) — drop anything can() denies (spec §4.3)
  const allowed: typeof chunks = [];
  for (const c of chunks) {
    if (await accessService.can(userId, c.scopeType as any, c.scopeId, 'VIEW')) allowed.push(c);
    if (allowed.length >= k) break;
  }
  return allowed;
}
```

- [ ] **Step 3: Run hybrid test — PASS.**

- [ ] **Step 4: Commit.**

```bash
git add apps/api/src/modules/ai/retrieval/retrieval.service.ts apps/api/src/modules/ai/__tests__/retrieval.hybrid.integration.test.ts
git commit -m "feat(11a): RetrievalService — hybrid FTS+cosine with two-layer permission filter"
```

---

### Task 9: THE security test (the hard one — spec §7)

**Files:**
- Test: `apps/api/src/modules/ai/__tests__/retrieval.security.integration.test.ts`

- [ ] **Step 1: Write the cross-tenant + intra-tenant negative test:**

```ts
it('a limited user retrieves NOTHING they cannot VIEW (cross-tenant + private space)', async () => {
  // Seed: Workspace A {private Space "Secret"→task "nuclear codes"; List "Public"→task "lunch"};
  //       Workspace B {task "tenant B secret"}; limited user U = guest on A's "Public" List only.
  // Index everything synchronously (runIndexJob).
  const hits = await retrievalService.retrieve(U.id, A.workspaceId, 'secret codes lunch');
  const ids = hits.map(h => h.objectId);
  expect(ids).toContain(publicTaskId);       // allowed
  expect(ids).not.toContain(secretTaskId);   // intra-tenant private space — denied
  expect(ids).not.toContain(tenantBTaskId);  // cross-tenant — denied
});

it('disabling the SP pre-filter still leaks nothing (can() is authoritative)', async () => {
  // Stub keywordCandidates/semanticCandidates to return ALL chunk ids (simulate an SP bug);
  // retrieve() must STILL exclude secretTaskId + tenantBTaskId via the can() recheck.
});
```

- [ ] **Step 2: Run — both PASS.** If the second fails, the `can()` re-check in Task 8 is not authoritative — fix before proceeding (this is the headline hole prior phases hit).

- [ ] **Step 3: Commit.**

```bash
git add apps/api/src/modules/ai/__tests__/retrieval.security.integration.test.ts
git commit -m "test(11a): cross-tenant + private-space retrieval security (defense-in-depth verified)"
```

---

### Task 10: `POST /ai/search` route + dev reindex hook

**Files:**
- Create: `apps/api/src/modules/ai/ai.routes.ts`, `ai.dev.routes.ts`
- Modify: `apps/api/src/server.ts` (mount both)
- Test: `apps/api/src/modules/ai/__tests__/search.route.integration.test.ts`

- [ ] **Step 1: Write failing route test** — owner POSTs `/ai/search {query}` → 200 with `RetrievedChunk[]`; a user without `ai.use` → 403; the limited user gets only visible chunks.

- [ ] **Step 2: Implement `ai.routes.ts`** mirroring `scheduled-report.routes.ts`: `zValidator('json', z.object({ query: z.string().min(1), scope: z.object({type:z.string(),id:z.string()}).optional(), k: z.number().int().positive().max(20).optional() }))`, `requirePermission('ai.use', { resolveWorkspace: resolveWorkspaceFromBody })`, handler reads `userId` from `c.get('user')`, calls `retrievalService.retrieve`, returns `{ data: chunks }`. Body must carry `workspaceId` for `resolveWorkspace`.

- [ ] **Step 3: Implement `ai.dev.routes.ts`** — `POST /ai/reindex` mirroring `automation.dev.routes.ts`: `NODE_ENV==='production'` ⇒ 404; body `{ workspaceId }`; enumerate that workspace's tasks/docs/comments and `runIndexJob` each synchronously; return counts.

- [ ] **Step 4: Mount in `server.ts`** — `app.route('/ai', aiRoutes)` near other module routes; mount `aiDevRoutes` with the other dev routes so the path is `/api/v1/dev/ai/reindex`.

- [ ] **Step 5: Run route tests — PASS.**

- [ ] **Step 6: Commit.**

```bash
git add apps/api/src/modules/ai/ai.routes.ts apps/api/src/modules/ai/ai.dev.routes.ts apps/api/src/server.ts apps/api/src/modules/ai/__tests__/search.route.integration.test.ts
git commit -m "feat(11a): POST /ai/search (ai.use gated) + dev /ai/reindex hook"
```

---

### Task 11: Whole-slice verification + DoD

- [ ] **Step 1: tsc clean.** Run the repo's API typecheck script. Expected: 0 errors.
- [ ] **Step 2: Full AI test run** on local Docker (safe env prefix from spec §9). Run: `npx vitest run apps/api/src/modules/ai`. Expected: all green, including both security tests.
- [ ] **Step 3: Migration reversibility** — apply `0063`/`0064`, run rollbacks, re-apply; clean each way.
- [ ] **Step 4: DECISIONS.md entry** — SQL-resident hybrid retrieval; two-layer filter with `can()` authoritative; Fake provider/embedder no-key default; `ai.use` seeded owner/admin/member; FTS dependency on the Docker image. Carry spec §8 deferrals (ANN, reranking, real-provider replay tests).
- [ ] **Step 5: Final opus whole-slice review** (do NOT skip — spec §9): focus on SP correctness, the authoritative `can()` gate, and `WorkspaceId` scoping on every `AiChunks` query. Address findings.
- [ ] **Step 6: ff-merge to main locally, STOP for review** before 11b.

---

## Self-Review Notes (gaps deferred by design)

- No LLM answer/citations surface yet — that's **11b**; 11a exercises `complete` only via the gateway audit test.
- `completeStructured` canned-object registry is stubbed; **11c/11e** extend it.
- FTS availability in the test container is a Task-1 risk — degrade keyword to `LIKE` + record delta if the image lacks Full-Text (semantic path via FakeEmbedder unaffected).
- No GraphQL surface in 11a (REST `/ai/search` is enough to prove retrieval). Pothos mirror lands in 11b alongside `aiAsk`.
