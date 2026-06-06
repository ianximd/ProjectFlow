/**
 * Idempotent, exception-safe passthrough for GraphQL-Yoga SSE response bodies.
 *
 * WHY THIS EXISTS
 * ───────────────
 * graphql-yoga serves subscriptions as Server-Sent Events whose response body is
 * a web `ReadableStream`. `@hono/node-server` pipes that stream into the Node
 * `http.ServerResponse`. On a routine SSE client disconnect, BOTH parties tear
 * the same stream down: @hono/node-server cancels the body it is piping, while
 * Yoga's own generator-backed source also closes. The SECOND teardown throws
 * `ERR_INVALID_STATE: ReadableStream is already closed` from a floating
 * microtask — previously an UNCAUGHT exception that killed the whole API on every
 * client disconnect.
 *
 * THE FIX
 * ───────
 * Interpose OUR OWN passthrough stream between Yoga and @hono/node-server. We
 * become the sole owner of a single reader on Yoga's stream and make every
 * teardown path (close / cancel / error) single-shot and try/catch-guarded. The
 * stream @hono/node-server actually touches therefore never double-closes — the
 * race is removed at the boundary instead of being swallowed globally after the
 * crash.
 *
 * The proxy is strictly pull-based (read-on-demand), so it preserves SSE
 * backpressure and never buffers events ahead of the consumer.
 */
export function guardedEventStream(
  src: ReadableStream<Uint8Array>,
): ReadableStream<Uint8Array> {
  const reader = src.getReader();

  // Single-shot latch: once the source reader has been released (via close,
  // error, or cancel) we must never touch it again. This is what makes every
  // teardown path at-most-once and immune to the double-close race.
  let released = false;

  /** Release the source reader exactly once; swallow any benign teardown throw. */
  async function releaseOnce(cancelReason?: unknown): Promise<void> {
    if (released) return;
    released = true;
    try {
      // cancel() both signals the source to stop AND releases the lock. A
      // benign "already closed" cancel (or any hostile source) must not throw
      // or reject out of here into a floating microtask.
      await reader.cancel(cancelReason);
    } catch {
      // intentionally swallowed — see module header
    }
  }

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      // If a prior teardown already released the source, close immediately.
      if (released) {
        try {
          controller.close();
        } catch {
          /* controller already closed — ignore */
        }
        return;
      }

      try {
        const { done, value } = await reader.read();
        if (done) {
          released = true; // source is exhausted; lock is already released
          controller.close();
          return;
        }
        controller.enqueue(value);
      } catch {
        // A read error from the source (e.g. teardown mid-flight) surfaces as a
        // GRACEFUL close, never a rethrow into a floating microtask that would
        // crash the process. Mark released so we never read again.
        released = true;
        try {
          controller.close();
        } catch {
          /* controller already closed — ignore */
        }
      }
    },

    cancel(reason) {
      // Consumer (@hono/node-server) cancelled us — propagate to the source at
      // most once, fully guarded.
      return releaseOnce(reason);
    },
  });
}
