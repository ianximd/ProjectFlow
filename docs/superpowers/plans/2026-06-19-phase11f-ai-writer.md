# Phase 11f — AI Writer (streaming) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `POST /ai/write` (streaming SSE) `{ mode: generate|edit|improve, context, selection? }` → `gateway.stream`, wired into the TipTap doc editor (generate at cursor; edit/improve a selection), the task description, and comments.

**Architecture:** A streaming Hono route using `hono/streaming`'s `streamSSE` (NEW pattern — no REST SSE exists today; current streaming is GraphQL-only). The gateway already exposes `stream()`. Output respects the selection: generate inserts at cursor; edit/improve replaces the selection.

**Tech Stack:** As 11a + Hono `streamSSE` + TipTap (`@tiptap/react`). NOTE: only the **Docs** editor uses TipTap; task description + comments are plain `<textarea>` — the writer there inserts/replaces plain text.

**Spec:** `docs/superpowers/specs/2026-06-18-ai-layer-phase11-design.md` §6 "11f", §5.1 (`stream`), §7. **Depends on 11a (`gateway.stream`).**

---

### Task 0: Reconciliation (FIRST)

- [ ] Confirm `gateway.stream(req)` returns `AsyncIterable<StreamChunk{delta}>` (11a) and `FakeProvider.stream` yields the `complete` output in chunks (deterministic).
- [ ] **Confirm SSE approach:** there is NO existing REST SSE route (current streaming is GraphQL subscriptions via `apps/api/src/graphql/sse-stream.ts`). Use Hono's `streamSSE` from `hono/streaming` for `POST /ai/write`. Verify `hono/streaming` is available in the installed Hono version; if not, fall back to a chunked `c.body(ReadableStream)` response.
- [ ] **Confirm editor surfaces (Explore-verified 2026-06-19):** `DocEditor.tsx` (`apps/next-web/src/components/docs/DocEditor.tsx`) is the ONLY TipTap surface (`useEditor`; slash-command file `slashCommands.ts` exists but isn't live-wired). Task description = `<textarea>` in `TaskDrawer.tsx` (~line 514); comments = `<textarea>` in `CommentSection.tsx` (~line 209).
- [ ] Confirm how the frontend reads a stream response (fetch + `ReadableStream` reader, or an existing helper).

---

## File Structure

```
apps/api/src/modules/ai/writer/
  writer.service.ts             # build mode prompt; expose async stream of deltas
  writer.prompt.ts              # pure: prompt per mode (generate|edit|improve)
apps/api/src/modules/ai/ai.routes.ts        # +POST /ai/write (streamSSE)
apps/api/src/modules/ai/__tests__/writer.prompt.unit.test.ts
apps/api/src/modules/ai/__tests__/writer.route.integration.test.ts
apps/next-web/src/lib/aiStream.ts           # client: POST + consume SSE deltas
apps/next-web/src/components/docs/DocEditor.tsx     # AI-write affordance (insert/replace)
apps/next-web/src/components/TaskDrawer.tsx          # AI-write on description textarea
apps/next-web/src/components/CommentSection.tsx      # AI-write on comment textarea
apps/next-web/messages/en.json / id.json     # +Ai.writer.* (parity)
e2e/ai-write.spec.ts
```

---

### Task 1: `writer.prompt.ts` — per-mode prompt (TDD)

**Files:** Create `apps/api/src/modules/ai/writer/writer.prompt.ts`; Test `__tests__/writer.prompt.unit.test.ts`

- [ ] **Step 1: Failing test.**

```ts
import { it, expect } from 'vitest';
import { buildWritePrompt } from '../writer/writer.prompt.js';
it('generate uses context; edit/improve include the selection', () => {
  expect(buildWritePrompt({ mode:'generate', context:'Sprint retro' })).toContain('Sprint retro');
  const edit = buildWritePrompt({ mode:'edit', context:'doc', selection:'teh cat' });
  expect(edit).toContain('teh cat');
  expect(buildWritePrompt({ mode:'improve', context:'doc', selection:'ok text' })).toContain('ok text');
});
```

- [ ] **Step 2: Run — FAIL. Step 3: Implement:**

```ts
// writer.prompt.ts
export interface WriteReq { mode: 'generate'|'edit'|'improve'; context: string; selection?: string; }
export function buildWritePrompt(r: WriteReq): string {
  switch (r.mode) {
    case 'generate': return `Write content for this context. Output only the content.\n\nContext: ${r.context}`;
    case 'edit':     return `Rewrite the selection per the instruction in the context. Output only the rewrite.\n\nContext: ${r.context}\nSelection: ${r.selection ?? ''}`;
    case 'improve':  return `Improve the selection (clarity, grammar, concision). Output only the improved text.\n\nSelection: ${r.selection ?? ''}`;
  }
}
```

- [ ] **Step 4: Run — PASS. Step 5: Commit.** `feat(11f): pure writer prompt builder (generate/edit/improve)`

---

### Task 2: `writer.service.ts` — stream deltas

**Files:** Create `writer.service.ts`

- [ ] **Step 1: Implement:**

```ts
export class WriterService {
  constructor(private gateway = aiGatewayService) {}
  async *write(userId: string, workspaceId: string, req: WriteReq): AsyncIterable<string> {
    const prompt = buildWritePrompt(req);
    for await (const chunk of this.gateway.stream({ workspaceId, userId, feature: 'writer' }, { prompt }))
      yield chunk.delta;
  }
}
```

`gateway.stream` records the `AiRuns` row after the iterator drains (11a). ponytail: no separate persistence — the writer streams; the editor decides insert vs replace client-side.

- [ ] **Step 2: Commit** (covered by Task 3). `feat(11f): WriterService — stream gateway deltas per mode`

---

### Task 3: `POST /ai/write` streaming route

**Files:** Modify `ai.routes.ts`; Test `__tests__/writer.route.integration.test.ts`

- [ ] **Step 1: Failing route test** — owner POSTs `{ workspaceId, mode:'generate', context:'x' }`; read the SSE body; assert concatenated deltas equal FakeProvider's deterministic output; no `ai.use` → 403.
- [ ] **Step 2: Implement `POST /ai/write`** with `streamSSE` (gate FIRST, then stream):

```ts
import { streamSSE } from 'hono/streaming';
aiRoutes.post('/write',
  zValidator('json', z.object({
    workspaceId: z.string(), mode: z.enum(['generate','edit','improve']),
    context: z.string(), selection: z.string().optional(),
  })),
  requirePermission('ai.use', { resolveWorkspace: resolveWorkspaceFromBody }),
  (c) => {
    const userId = (c.get('user') as any).userId as string;
    const body = c.req.valid('json');
    return streamSSE(c, async (stream) => {
      for await (const delta of writerService.write(userId, body.workspaceId, body))
        await stream.writeSSE({ data: delta });
      await stream.writeSSE({ event: 'done', data: '' });
    });
  });
```

- [ ] **Step 3: Run — PASS.** If `hono/streaming` is unavailable, use `return c.body(readable, { headers: { 'content-type':'text/event-stream' } })` with a `ReadableStream` built from the async iterator; update the test reader accordingly.
- [ ] **Step 4: Commit.** `feat(11f): POST /ai/write streaming SSE (ai.use gated)`

---

### Task 4: Client stream helper + editor affordances + i18n

**Files:** Create `apps/next-web/src/lib/aiStream.ts`; Modify `DocEditor.tsx`, `TaskDrawer.tsx`, `CommentSection.tsx`, `messages/en.json`, `id.json`

- [ ] **Step 1: `aiStream.ts`** — `async function* streamWrite(body): AsyncIterable<string>` that POSTs to `/ai/write` and yields SSE `data` deltas (fetch + `response.body.getReader()` + SSE line parse).
- [ ] **Step 2: DocEditor (TipTap)** — add an "AI write" action (attach to the slash menu or a small toolbar button): `generate` inserts deltas at the cursor (`editor.commands.insertContent` per delta); `edit`/`improve` on a non-empty selection replaces it (`editor.commands.insertContentAt(range, ...)` / delete-then-insert). Stream live so the user sees tokens appear.
- [ ] **Step 3: Task description + comment textareas** — add a small "AI ✨" button that streams `generate` (append at caret) or `improve` (replace selected text via `selectionStart/selectionEnd`). Plain-text insert/replace (no TipTap here).
- [ ] **Step 4: Add `Ai.writer.*` keys to en + id (parity).**
- [ ] **Step 5: Web unit test** — `aiStream` parses SSE deltas; the doc affordance inserts text. Run — PASS. **Step 6: Commit.** `feat(11f): AI writer affordances (doc/task/comment) + SSE client + en/id i18n`

---

### Task 5: e2e + DoD

- [ ] **Step 1: Playwright `e2e/ai-write.spec.ts`** — in a doc, trigger AI generate at cursor and assert streamed text lands in the editor; select text and "improve" and assert it's replaced. In a task, generate into the description. (FakeProvider → deterministic.)
- [ ] **Step 2:** tsc (api) + Next build clean; full `npx vitest run apps/api/src/modules/ai` green; en/id parity.
- [ ] **Step 3:** DECISIONS.md entry (first REST SSE via `hono/streaming`; writer streams only — no server persistence; TipTap insert/replace for docs, textarea for task/comment).
- [ ] **Step 4: Final opus whole-slice review** (do NOT skip) — confirm the `ai.use` gate runs BEFORE the stream opens (no streaming to an unauthorized user) and the stream records an `AiRuns` row.
- [ ] **Step 5: ff-merge to main locally, STOP for review.** Phase 11 (features 1–5) complete; stretch agents (#6) remain deferred per spec §8.

---

## Self-Review Notes
- Writer doesn't retrieve workspace content (generation/edit tool, not Q&A) → no retrieval permission surface here; the only gate is `ai.use`. A future "write using my tasks" mode must route through `RetrievalService` (11a) — out of scope for v1.
- Task/comment are plain textareas (not TipTap) — the spec's "stream into TipTap" applies only to Docs; task/comment get plain-text affordances. Flagged in Task 0.
- SSE is a new pattern for REST in this codebase — Task 3 has a `c.body(ReadableStream)` fallback if `hono/streaming` isn't present.
