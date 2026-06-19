/**
 * Core provider abstraction for the AI Gateway (Phase 11a).
 *
 * All LLM communication flows through AiProvider implementations so the
 * rest of the codebase stays provider-agnostic. FakeProvider is used in
 * tests; AnthropicProvider is the production default when ANTHROPIC_API_KEY
 * is set.
 */

export type AiFeature =
  | 'qa'
  | 'ai_field'
  | 'standup'
  | 'nl_automation'
  | 'writer'
  | 'search';

/** A chunk of context retrieved from the hybrid-search pipeline. */
export interface RetrievedSource {
  id: string;
  objectType: string;
  objectId: string;
  content: string;
}

/** Input to a plain-text completion. */
export interface CompleteRequest {
  prompt: string;
  system?: string;
  sources?: RetrievedSource[];
  maxTokens?: number;
}

/** Output from a plain-text completion. */
export interface CompleteResult {
  text: string;
  promptTokens?: number;
  completionTokens?: number;
}

/** Input to a structured (JSON) completion. */
export interface StructuredRequest<T> extends CompleteRequest {
  schemaName: string;
  jsonSchema: object;
}

/** A single text delta from a streaming completion. */
export interface StreamChunk {
  delta: string;
}

/** Provider contract — one implementation per LLM backend. */
export interface AiProvider {
  readonly name: string;
  complete(req: CompleteRequest): Promise<CompleteResult>;
  completeStructured<T>(req: StructuredRequest<T>): Promise<T>;
  stream(req: CompleteRequest): AsyncIterable<StreamChunk>;
}
