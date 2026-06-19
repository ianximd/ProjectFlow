import type { Embedder } from './embedder.types.js';
import { FakeEmbedder } from './fake.embedder.js';

/**
 * Production embedder backed by the Voyage AI REST API.
 *
 * Requires `VOYAGE_API_KEY` in the environment.
 * Optional `VOYAGE_MODEL` overrides the default model ("voyage-3").
 *
 * No automated tests — requires a live API key; use makeEmbedder() which
 * falls back to FakeEmbedder when the key is absent.
 */
export class VoyageEmbedder implements Embedder {
  readonly model = process.env.VOYAGE_MODEL ?? 'voyage-3';

  async embed(texts: string[]): Promise<Float32Array[]> {
    const res = await fetch('https://api.voyageai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${process.env.VOYAGE_API_KEY}`,
      },
      body: JSON.stringify({ model: this.model, input: texts }),
    });

    if (!res.ok) throw new Error(`Voyage ${res.status}: ${await res.text()}`);

    const json = (await res.json()) as { data: { embedding: number[] }[] };
    return json.data.map((d) => Float32Array.from(d.embedding));
  }
}

/**
 * Factory: returns a VoyageEmbedder when `VOYAGE_API_KEY` is set,
 * otherwise falls back to the offline FakeEmbedder.
 */
export function makeEmbedder(): Embedder {
  return process.env.VOYAGE_API_KEY ? new VoyageEmbedder() : new FakeEmbedder();
}
