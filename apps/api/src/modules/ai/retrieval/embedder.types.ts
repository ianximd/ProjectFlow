/**
 * Core embedding abstraction used by the AI retrieval pipeline.
 *
 * Implementations: FakeEmbedder (deterministic, offline),
 * VoyageEmbedder (Voyage AI REST API, env-keyed).
 */
export interface Embedder {
  /** Identifies the underlying model, e.g. "fake-1" or "voyage-3". */
  readonly model: string;

  /**
   * Embed a batch of texts.
   *
   * @param texts  One or more strings to embed (may include empty strings).
   * @returns      One Float32Array per input text, all of the same dimension.
   */
  embed(texts: string[]): Promise<Float32Array[]>;
}
