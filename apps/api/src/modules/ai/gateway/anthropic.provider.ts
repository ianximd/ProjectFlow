/**
 * AnthropicProvider — production LLM backend via @anthropic-ai/sdk (0.55.x).
 *
 * SDK version installed: 0.55.1.  API surface confirmed by inspecting the
 * installed package at node_modules/@anthropic-ai/sdk:
 *
 *   - messages.create()  — plain non-streaming completion
 *   - messages.stream()  — streaming; yields RawMessageStreamEvent; use
 *                          .finalMessage() to get usage after drain
 *   - thinking param     — { type: 'enabled', budget_tokens: N } | { type: 'disabled' }
 *                          ('adaptive' is NOT in this SDK version; use enabled with a
 *                          budget when thinking is desired)
 *   - messages.parse()   — does NOT exist in 0.55.x; structured output is
 *                          implemented here via tool_choice: { type: 'tool' } with
 *                          a single-tool whose input_schema is req.jsonSchema.
 *   - output_config      — NOT in 0.55.x; omitted.
 *
 * NOTE: The claude-api skill documents a newer SDK surface (adaptive thinking,
 * messages.parse(), output_config). Those features are not yet available in the
 * installed 0.55.1 package. This implementation uses the actual installed types.
 * Upgrade @anthropic-ai/sdk when those features are needed.
 *
 * Sources are injected into the system prompt as a numbered citation block
 * so the model can reference them by [sourceId].
 *
 * Model: claude-opus-4-8 (default), overridable via AI_MODEL env var.
 * Default max_tokens: 1024 (overridable per-request via req.maxTokens).
 *
 * No automated test — requires a live ANTHROPIC_API_KEY.
 * Use AiGatewayService with FakeProvider (makeProvider() default) in tests.
 */

import Anthropic from '@anthropic-ai/sdk';
import type {
  AiProvider,
  CompleteRequest,
  CompleteResult,
  StreamChunk,
  StructuredRequest,
} from './provider.types.js';

const DEFAULT_MODEL      = 'claude-opus-4-8';
const DEFAULT_MAX_TOKENS = 1024;

/** Format retrieved sources as a system-prompt citation block. */
function sourcesBlock(req: CompleteRequest): string {
  const sources = req.sources ?? [];
  if (sources.length === 0) return '';
  const lines = sources.map(
    (s) => `[${s.id}] (${s.objectType} ${s.objectId})\n${s.content}`,
  );
  return `\n\n<sources>\n${lines.join('\n\n')}\n</sources>`;
}

/** Build the system string, merging caller's system + sources block. */
function buildSystem(req: CompleteRequest): string | undefined {
  const merged = (req.system ?? '') + sourcesBlock(req);
  return merged.trim() || undefined;
}

export class AnthropicProvider implements AiProvider {
  readonly name = 'anthropic';

  private readonly client = new Anthropic();
  private readonly model  = process.env.AI_MODEL ?? DEFAULT_MODEL;

  // -------------------------------------------------------------------------
  // complete
  // -------------------------------------------------------------------------
  async complete(req: CompleteRequest): Promise<CompleteResult> {
    const maxTokens = req.maxTokens ?? DEFAULT_MAX_TOKENS;
    const response = await this.client.messages.create({
      model:      this.model,
      max_tokens: maxTokens,
      // Thinking requires budget_tokens < max_tokens and budget ≥ 1024.
      // Only enable when we have enough token budget; otherwise omit.
      ...(maxTokens > 1024
        ? { thinking: { type: 'enabled' as const, budget_tokens: Math.floor(maxTokens * 0.5) } }
        : {}),
      system:     buildSystem(req),
      messages:   [{ role: 'user', content: req.prompt }],
    });

    const textBlock = response.content.find(
      (b): b is Anthropic.TextBlock => b.type === 'text',
    );

    return {
      text:             textBlock?.text ?? '',
      promptTokens:     response.usage.input_tokens,
      completionTokens: response.usage.output_tokens,
    };
  }

  // -------------------------------------------------------------------------
  // completeStructured — tool_choice forces a single structured tool call
  // whose input_schema is req.jsonSchema; the tool input IS the result.
  // -------------------------------------------------------------------------
  async completeStructured<T>(req: StructuredRequest<T>): Promise<T> {
    const response = await this.client.messages.create({
      model:      this.model,
      max_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
      system:     buildSystem(req),
      messages:   [{ role: 'user', content: req.prompt }],
      tools: [
        {
          name:         req.schemaName,
          description:  `Respond using the ${req.schemaName} schema.`,
          input_schema: req.jsonSchema as Anthropic.Tool['input_schema'],
        },
      ],
      tool_choice: { type: 'tool', name: req.schemaName },
    });

    const toolBlock = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
    );

    if (!toolBlock) {
      throw new Error(
        `AnthropicProvider: no tool_use block in response for schema '${req.schemaName}'`,
      );
    }

    // tool input is already parsed by the SDK (it's `unknown`, not a string)
    return toolBlock.input as T;
  }

  // -------------------------------------------------------------------------
  // stream — yields text_delta chunks from the streaming API
  // -------------------------------------------------------------------------
  async *stream(req: CompleteRequest): AsyncIterable<StreamChunk> {
    const maxTokens = req.maxTokens ?? DEFAULT_MAX_TOKENS;
    const stream = this.client.messages.stream({
      model:      this.model,
      max_tokens: maxTokens,
      ...(maxTokens > 1024
        ? { thinking: { type: 'enabled' as const, budget_tokens: Math.floor(maxTokens * 0.5) } }
        : {}),
      system:     buildSystem(req),
      messages:   [{ role: 'user', content: req.prompt }],
    });

    for await (const event of stream) {
      if (
        event.type === 'content_block_delta' &&
        event.delta.type === 'text_delta'
      ) {
        yield { delta: event.delta.text };
      }
    }

    // Drain to completion so the stream is closed cleanly and usage is accounted.
    await stream.finalMessage();
  }
}
