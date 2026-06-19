/**
 * AiGatewayService — provider-agnostic gateway with AiRuns audit.
 *
 * Wraps an AiProvider so every completion call is recorded in dbo.AiRuns
 * regardless of which provider or feature is being used.
 *
 * Provider selection (makeProvider):
 *   ANTHROPIC_API_KEY set → AnthropicProvider
 *   otherwise             → FakeProvider (offline, deterministic)
 *
 * Streaming: the AiRuns row is written AFTER the iterator fully drains.
 * On error it is written immediately with status='error'.
 */

import { AiRepository } from '../ai.repository.js';
import { FakeProvider } from './fake.provider.js';
import type {
  AiFeature,
  AiProvider,
  CompleteRequest,
  CompleteResult,
  StreamChunk,
  StructuredRequest,
} from './provider.types.js';

export type GatewayContext = {
  workspaceId: string;
  userId: string;
  feature: AiFeature;
};

/** Returns FakeProvider unless ANTHROPIC_API_KEY is set. */
export function makeProvider(): AiProvider {
  if (process.env.ANTHROPIC_API_KEY) {
    // AnthropicProvider is imported eagerly via require() (synchronous); it is
    // only instantiated when ANTHROPIC_API_KEY is set, keeping the Anthropic SDK
    // out of the module graph in key-absent environments (e.g. unit tests).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { AnthropicProvider } = require('./anthropic.provider.js') as typeof import('./anthropic.provider.js');
    return new AnthropicProvider();
  }
  return new FakeProvider();
}

export class AiGatewayService {
  constructor(
    private readonly provider: AiProvider = makeProvider(),
    private readonly repo: Pick<AiRepository, 'recordRun'> = new AiRepository(),
  ) {}

  // -------------------------------------------------------------------------
  // complete
  // -------------------------------------------------------------------------
  async complete(ctx: GatewayContext, req: CompleteRequest): Promise<CompleteResult> {
    const start = Date.now();
    try {
      const result = await this.provider.complete(req);
      await this.repo.recordRun({
        ...ctx,
        provider:         this.provider.name,
        status:           'ok',
        promptTokens:     result.promptTokens ?? null,
        completionTokens: result.completionTokens ?? null,
        latencyMs:        Date.now() - start,
      });
      return result;
    } catch (e: unknown) {
      await this.repo.recordRun({
        ...ctx,
        provider:  this.provider.name,
        status:    'error',
        latencyMs: Date.now() - start,
        error:     e instanceof Error ? e.message : String(e),
      });
      throw e;
    }
  }

  // -------------------------------------------------------------------------
  // completeStructured
  // -------------------------------------------------------------------------
  async completeStructured<T>(
    ctx: GatewayContext,
    req: StructuredRequest<T>,
  ): Promise<T> {
    const start = Date.now();
    try {
      const result = await this.provider.completeStructured<T>(req);
      await this.repo.recordRun({
        ...ctx,
        provider:  this.provider.name,
        status:    'ok',
        latencyMs: Date.now() - start,
      });
      return result;
    } catch (e: unknown) {
      await this.repo.recordRun({
        ...ctx,
        provider:  this.provider.name,
        status:    'error',
        latencyMs: Date.now() - start,
        error:     e instanceof Error ? e.message : String(e),
      });
      throw e;
    }
  }

  // -------------------------------------------------------------------------
  // stream — records the AiRuns row after the iterator drains
  // -------------------------------------------------------------------------
  async *stream(ctx: GatewayContext, req: CompleteRequest): AsyncIterable<StreamChunk> {
    const start = Date.now();
    try {
      for await (const chunk of this.provider.stream(req)) {
        yield chunk;
      }
      await this.repo.recordRun({
        ...ctx,
        provider:  this.provider.name,
        status:    'ok',
        latencyMs: Date.now() - start,
      });
    } catch (e: unknown) {
      await this.repo.recordRun({
        ...ctx,
        provider:  this.provider.name,
        status:    'error',
        latencyMs: Date.now() - start,
        error:     e instanceof Error ? e.message : String(e),
      });
      throw e;
    }
  }
}
