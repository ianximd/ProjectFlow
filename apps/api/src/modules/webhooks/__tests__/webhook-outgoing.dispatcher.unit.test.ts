import { afterEach, describe, expect, it, vi } from 'vitest';
import { deliverWebhook } from '../webhook-outgoing.dispatcher.js';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

describe('deliverWebhook body cap', () => {
  it('truncates large server responses before storing', async () => {
    const big = 'A'.repeat(1024 * 1024); // 1 MB
    globalThis.fetch = vi.fn(async () =>
      new Response(big, { status: 200 }),
    ) as any;

    const result = await deliverWebhook(
      'http://example.test/hook',
      'secret',
      'task.created',
      { id: '1' },
    );

    // The dispatcher additionally slice()s to 2000 chars for the log row.
    expect(result.responseBody.length).toBeLessThanOrEqual(2000);
    expect(result.success).toBe(true);
  });

  it('returns the small body verbatim', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response('ok', { status: 200 }),
    ) as any;
    const result = await deliverWebhook('http://x/h', 's', 'e', {});
    expect(result.responseBody).toBe('ok');
  });
});
