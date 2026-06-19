/**
 * Deterministic, offline AI provider for unit tests and dev environments.
 *
 * - complete()          → echoes prompt + source ids (enables citation assertions)
 * - completeStructured() → returns a typed stub carrying schemaName + source ids
 * - stream()            → yields the same text as complete() word-by-word
 *
 * No network I/O, no API keys required.
 */

import type {
  AiProvider,
  CompleteRequest,
  CompleteResult,
  StructuredRequest,
  StreamChunk,
} from './provider.types.js';

export class FakeProvider implements AiProvider {
  readonly name = 'fake';

  async complete(req: CompleteRequest): Promise<CompleteResult> {
    const ids = (req.sources ?? []).map((s) => s.id).join(',');
    const text = `[fake answer] ${req.prompt.slice(0, 80)}${ids ? ` sources:${ids}` : ''}`;
    return { text, promptTokens: req.prompt.length, completionTokens: text.length };
  }

  async completeStructured<T>(req: StructuredRequest<T>): Promise<T> {
    return ({
      __fake: true,
      schema: req.schemaName,
      sources: (req.sources ?? []).map((s) => s.id),
    } as unknown) as T;
  }

  async *stream(req: CompleteRequest): AsyncIterable<StreamChunk> {
    const { text } = await this.complete(req);
    for (const word of text.split(' ')) {
      yield { delta: word + ' ' };
    }
  }
}
