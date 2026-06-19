/**
 * Unit tests for AiGateway components — no DB, no network.
 * FakeProvider is exercised in full; AiGatewayService uses a stub repo.
 */

import { it, expect, describe, vi, beforeEach } from 'vitest';
import { FakeProvider } from '../gateway/fake.provider.js';
import { AiGatewayService } from '../gateway/ai-gateway.service.js';
import type { CompleteRequest } from '../gateway/provider.types.js';

// ---------------------------------------------------------------------------
// FakeProvider — specified behaviour
// ---------------------------------------------------------------------------
describe('FakeProvider', () => {
  const p = new FakeProvider();

  it('name is "fake"', () => {
    expect(p.name).toBe('fake');
  });

  it('echoes retrieved source ids so citation assertions are exact', async () => {
    const r = await p.complete({
      prompt: 'q',
      sources: [{ id: 'c1', objectType: 'task', objectId: 't1', content: 'x' }],
    });
    expect(r.text).toContain('c1');
  });

  it('returns promptTokens equal to prompt.length', async () => {
    const r = await p.complete({ prompt: 'hello world' });
    expect(r.promptTokens).toBe('hello world'.length);
  });

  it('returns completionTokens equal to text.length', async () => {
    const r = await p.complete({ prompt: 'hi' });
    expect(r.completionTokens).toBe(r.text.length);
  });

  it('completeStructured echoes schemaName and source ids', async () => {
    const result = await p.completeStructured({
      prompt: 'structured',
      schemaName: 'MySchema',
      jsonSchema: { type: 'object' },
      sources: [
        { id: 'src1', objectType: 'doc', objectId: 'd1', content: 'some doc' },
        { id: 'src2', objectType: 'task', objectId: 't2', content: 'a task' },
      ],
    });
    const r = result as any;
    expect(r.__fake).toBe(true);
    expect(r.schema).toBe('MySchema');
    expect(r.sources).toEqual(['src1', 'src2']);
  });

  it('completeStructured with no sources returns empty sources array', async () => {
    const result = await p.completeStructured({
      prompt: 'go',
      schemaName: 'Empty',
      jsonSchema: {},
    });
    const r = result as any;
    expect(r.sources).toEqual([]);
  });

  it('stream concatenates back to the same text as complete()', async () => {
    const req: CompleteRequest = {
      prompt: 'hello from stream',
      sources: [{ id: 'x1', objectType: 'task', objectId: 't3', content: 'ctx' }],
    };
    const direct = await p.complete(req);
    let accumulated = '';
    for await (const chunk of p.stream(req)) {
      accumulated += chunk.delta;
    }
    // trim trailing space that stream adds per word
    expect(accumulated.trim()).toBe(direct.text);
  });

  it('stream yields multiple chunks', async () => {
    const chunks: string[] = [];
    for await (const chunk of p.stream({ prompt: 'one two three' })) {
      chunks.push(chunk.delta);
    }
    // "one two three" is 3 words → at least 2 chunks (space-split)
    expect(chunks.length).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// AiGatewayService — audit stub
// ---------------------------------------------------------------------------
describe('AiGatewayService', () => {
  let recordRun: ReturnType<typeof vi.fn>;
  let service: AiGatewayService;

  beforeEach(() => {
    recordRun = vi.fn().mockResolvedValue(undefined);
    const stubRepo = { recordRun } as any;
    service = new AiGatewayService(new FakeProvider(), stubRepo);
  });

  it('complete() returns the provider result', async () => {
    const ctx = { workspaceId: 'ws1', userId: 'u1', feature: 'search' as const };
    const r = await service.complete(ctx, { prompt: 'what is this?' });
    expect(r.text).toContain('what is this?');
  });

  it('complete() calls recordRun exactly once with status ok', async () => {
    const ctx = { workspaceId: 'ws1', userId: 'u1', feature: 'qa' as const };
    await service.complete(ctx, { prompt: 'test' });
    expect(recordRun).toHaveBeenCalledTimes(1);
    expect(recordRun).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'ok', provider: 'fake', feature: 'qa' }),
    );
  });

  it('complete() records status=error and rethrows on provider failure', async () => {
    const boom = new Error('provider exploded');
    const failProvider = {
      name: 'fake',
      complete: vi.fn().mockRejectedValue(boom),
      completeStructured: vi.fn(),
      stream: vi.fn(),
    };
    const svc = new AiGatewayService(failProvider as any, { recordRun } as any);
    await expect(
      svc.complete({ workspaceId: 'ws', userId: 'u', feature: 'qa' }, { prompt: 'fail' }),
    ).rejects.toThrow('provider exploded');
    expect(recordRun).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'error' }),
    );
  });

  it('completeStructured() calls recordRun with status ok', async () => {
    const ctx = { workspaceId: 'ws1', userId: 'u1', feature: 'ai_field' as const };
    await service.completeStructured(ctx, {
      prompt: 'extract',
      schemaName: 'Foo',
      jsonSchema: {},
    });
    expect(recordRun).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'ok', feature: 'ai_field' }),
    );
  });

  it('stream() calls recordRun once after drain with status ok', async () => {
    const ctx = { workspaceId: 'ws1', userId: 'u1', feature: 'writer' as const };
    const chunks: string[] = [];
    for await (const c of service.stream(ctx, { prompt: 'a b c' })) {
      chunks.push(c.delta);
    }
    expect(chunks.length).toBeGreaterThan(0);
    expect(recordRun).toHaveBeenCalledTimes(1);
    expect(recordRun).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'ok', feature: 'writer' }),
    );
  });
});
