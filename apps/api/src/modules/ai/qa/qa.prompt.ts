import type { RetrievedSource } from '../gateway/provider.types.js';

// Accepts the shape RetrievalService.retrieve() returns (RetrievedChunk has
// id/objectType/objectId/scopeType/scopeId/content — no score). Only
// objectType/objectId/content are used to build the prompt.
interface PromptChunk {
  objectType: string;
  objectId: string;
  content: string;
}

/**
 * Build a numbered-source prompt. Sources are numbered [1..n] and the model is
 * instructed to cite inline as [n]; the returned `sources` map those indices
 * back to the underlying objects so citations can be resolved after generation.
 */
export function buildAskPrompt(
  question: string,
  chunks: PromptChunk[],
): { prompt: string; sources: RetrievedSource[] } {
  const sources: RetrievedSource[] = chunks.map((c, i) => ({
    id: String(i + 1),
    objectType: c.objectType,
    objectId: c.objectId,
    content: c.content,
  }));
  const ctx = sources.map((s) => `[${s.id}] (${s.objectType}) ${s.content}`).join('\n');
  const prompt =
    `Answer the question using ONLY the numbered sources. Cite sources inline as [n]. ` +
    `If the sources don't contain the answer, say so.\n\nSources:\n${ctx}\n\nQuestion: ${question}`;
  return { prompt, sources };
}

/**
 * Parse `[n]` citations out of an answer and resolve them back to object refs.
 * Dedupes repeated citations (Set); citation indices not present in `sources`
 * (out of range) are silently ignored — citations are therefore always a subset
 * of the already-permission-filtered sources.
 */
export function parseCitations(
  answer: string,
  sources: RetrievedSource[],
): { objectType: string; objectId: string }[] {
  const cited = new Set([...answer.matchAll(/\[(\d+)\]/g)].map((m) => m[1]));
  return sources
    .filter((s) => cited.has(s.id))
    .map((s) => ({ objectType: s.objectType, objectId: s.objectId }));
}
