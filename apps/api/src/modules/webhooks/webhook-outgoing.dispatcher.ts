import crypto from 'node:crypto';

/**
 * Sign a webhook payload with HMAC-SHA256.
 * Returns the value to use in the X-ProjectFlow-Signature header.
 */
export function signPayload(payload: string, secret: string): string {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(payload);
  return 'sha256=' + hmac.digest('hex');
}

/** Read up to `max` bytes from a Response body, then cancel the stream. */
async function readBounded(res: Response, max: number): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < max) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = max - total;
      const slice = value.byteLength > remaining ? value.slice(0, remaining) : value;
      chunks.push(slice);
      total += slice.byteLength;
      if (value.byteLength > remaining) break;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
}

export interface DeliveryResult {
  statusCode: number | null;
  responseBody: string;
  durationMs: number;
  success: boolean;
}

/**
 * Send a signed HTTP POST to the webhook endpoint.
 * This is called by the BullMQ worker on each attempt.
 */
export async function deliverWebhook(
  url: string,
  secret: string,
  event: string,
  payload: Record<string, unknown>,
): Promise<DeliveryResult> {
  const body = JSON.stringify({
    event,
    timestamp: new Date().toISOString(),
    data: payload,
  });

  const signature = signPayload(body, secret);
  const start = Date.now();

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type':              'application/json',
        'X-ProjectFlow-Signature':   signature,
        'X-ProjectFlow-Event':       event,
        'User-Agent':                'ProjectFlow-Webhooks/1.0',
      },
      body,
      signal: AbortSignal.timeout(10_000), // 10-second delivery timeout
    });

    const responseBody = await readBounded(res, 64 * 1024).catch(() => '');
    const durationMs   = Date.now() - start;

    return {
      statusCode:   res.status,
      responseBody: responseBody.slice(0, 2000), // truncate
      durationMs,
      success:      res.status >= 200 && res.status < 300,
    };
  } catch (err: any) {
    return {
      statusCode:   null,
      responseBody: err?.message ?? 'Unknown error',
      durationMs:   Date.now() - start,
      success:      false,
    };
  }
}
