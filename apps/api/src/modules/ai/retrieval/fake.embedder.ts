import { createHash } from 'node:crypto';
import type { Embedder } from './embedder.types.js';

const DIM = 256;

/**
 * Deterministic, offline embedder for use in tests and dev environments.
 *
 * Each token is hashed with SHA-256 and its byte values are accumulated
 * into a 256-dimensional float vector, which is then L2-normalised.
 * Empty strings yield an all-zeros vector (norm 0 → divided by 1).
 */
export class FakeEmbedder implements Embedder {
  readonly model = 'fake-1';

  async embed(texts: string[]): Promise<Float32Array[]> {
    return texts.map((t) => {
      const v = new Float32Array(DIM);

      for (const tok of t.toLowerCase().split(/\s+/).filter(Boolean)) {
        const h = createHash('sha256').update(tok).digest();
        for (let i = 0; i < DIM; i++) v[i] += (h[i % h.length] - 128) / 128;
      }

      // L2-normalise; guard against zero vector (empty input).
      let norm = 0;
      for (let i = 0; i < DIM; i++) norm += v[i] * v[i];
      norm = Math.sqrt(norm) || 1;
      for (let i = 0; i < DIM; i++) v[i] /= norm;

      return v;
    });
  }
}
