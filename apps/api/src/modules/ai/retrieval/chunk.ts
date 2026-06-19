/**
 * Text chunking utilities for AI retrieval.
 *
 * Splits long text into overlapping chunks of approximately 400 tokens each,
 * using a word-count heuristic (1 token ≈ 0.75 words / 1 word ≈ 1.33 tokens).
 */

export interface Chunk {
  /** Zero-based sequence number within the source document. */
  seq: number;
  /** Reconstructed text slice (space-joined words). */
  content: string;
  /** Estimated token count for this chunk. */
  tokenCount: number;
}

const TARGET_TOKENS = 400;
const OVERLAP_WORDS = 40;

/**
 * Estimate token count from a string using a simple word-count heuristic.
 * 1 word ≈ 1 / 0.75 = 1.33 tokens → tokens ≈ words / 0.75.
 */
const estTokens = (s: string): number =>
  Math.ceil(s.trim().split(/\s+/).filter(Boolean).length / 0.75);

/**
 * Split `text` into overlapping chunks of ~TARGET_TOKENS tokens each.
 *
 * @param text  Source text (any length).
 * @returns     Array of Chunk objects ordered by seq. Returns [] for blank input.
 */
export function chunkText(text: string): Chunk[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  // Convert target token count to approximate word count.
  // TARGET_TOKENS tokens × 0.75 words/token ≈ 300 words per chunk.
  const wordsPerChunk = Math.ceil(TARGET_TOKENS * 0.75); // 300
  const step = wordsPerChunk - OVERLAP_WORDS;             // 260

  const out: Chunk[] = [];
  let seq = 0;
  for (let start = 0; start < words.length; start += step, seq++) {
    const slice = words.slice(start, start + wordsPerChunk).join(' ');
    out.push({ seq, content: slice, tokenCount: estTokens(slice) });
    // Stop if this chunk covered the last word.
    if (start + wordsPerChunk >= words.length) break;
  }
  return out;
}
