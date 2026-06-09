import { Server } from '@hocuspocus/server';
import { Redis } from '@hocuspocus/extension-redis';
import * as Y from 'yjs';
import type { IncomingMessage, Server as HttpServer } from 'node:http';
import type { Duplex } from 'node:stream';
import { authenticateCollab, type CollabAuthContext } from './collab.auth.js';
import { CollabRepository } from './collab.repository.js';
import { renderSnapshot, seedYDoc, docNameToTarget } from './yjsPersistence.js';
import { getRedis } from '../../shared/lib/redis.js';
import { subLogger } from '../../shared/lib/logger.js';

const log = subLogger('collab');
const repo = new CollabRepository();

/**
 * The crossws Node adapter exposed (privately, in TS terms) on a Hocuspocus
 * v4 `Server`. We reach it to route an *existing* HTTP server's upgrade
 * events at the Hocuspocus connection handler, instead of letting Hocuspocus
 * spin up and listen on its own HTTP server.
 */
interface NodeUpgradeAdapter {
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer, webRequest?: Request): Promise<void> | void;
}
/** The `crossws` field is `private` in Hocuspocus's TS surface but present at
 *  runtime; reach it through an `unknown` cast rather than declaring a subtype
 *  (a subtype can't legally re-expose a private member). */
interface ServerWithCrossws { crossws: NodeUpgradeAdapter; }

/**
 * Build the Hocuspocus server. Generic over `<kind>:<id>` so 7b reuses it.
 *
 * Hocuspocus v4.1.0 notes (verified against installed dist):
 *  - `Server` is a CLASS instantiated with `new Server(config)`; there is NO
 *    static `Server.configure(...)` (that lives on the internal `Hocuspocus`).
 *  - Constructing the Server wires its own (idle) http server + a crossws
 *    Node adapter; we never call `.listen()`, so nothing binds a port. We feed
 *    upgrades to `server.crossws.handleUpgrade(...)` from server.ts instead.
 *  - `onAuthenticate({ token, documentName })` — its return value becomes the
 *    connection `context`, later surfaced as `lastContext` on store hooks.
 *  - `onLoadDocument({ document, documentName })` — mutate/return the doc.
 *  - `onStoreDocument({ document, documentName })` — NO `context` field in v4;
 *    it carries `lastContext`/`lastTransactionOrigin` instead, neither needed
 *    here since the page id is derived from `documentName`.
 *  - Debounce/maxDebounce coalesce a keystroke burst into one DB write.
 */
export function buildCollabServer(): Server {
  const extensions = [] as unknown[];
  // Multi-instance fan-out over the existing shared ioredis. Single-instance
  // dev (and the test import) work fine without it — guarded + optional.
  try {
    const redisClient = getRedis();
    if (redisClient) {
      // Reuse the existing ioredis instance (the extension `Configuration`
      // accepts a `redis` instance to duplicate from). Avoids a second
      // connection pool and honours REDIS_URL exactly as the rest of the app.
      extensions.push(new Redis({ redis: redisClient }));
    }
  } catch {
    /* Redis optional in dev — fan-out simply degrades to single-instance. */
  }

  return new Server({
    name: 'projectflow-collab',
    extensions: extensions as never,
    // 2s debounce: coalesce a burst of keystrokes into one DB write.
    debounce: 2000,
    maxDebounce: 10000,
    // Quiet — we never call listen(), the start screen would be misleading.
    quiet: true,

    async onAuthenticate(data): Promise<CollabAuthContext> {
      // The returned context is attached to the connection and surfaced to
      // later hooks. We don't depend on it in store/load (page id comes from
      // documentName), but returning it enforces auth + records who connected.
      return authenticateCollab(data.token, data.documentName);
    },

    async onLoadDocument(data): Promise<Y.Doc> {
      const target = docNameToTarget(data.documentName);
      if (!target) throw new Error('Invalid document name');
      const bytes = await repo.loadYjs(target.id);
      if (bytes) seedYDoc(data.document, bytes);
      return data.document;
    },

    async onStoreDocument(data): Promise<void> {
      const target = docNameToTarget(data.documentName);
      if (!target) return;
      const bodyYjs = Buffer.from(Y.encodeStateAsUpdate(data.document));
      const bodyJson = renderSnapshot(data.document);
      await repo.persistYjs(target.id, bodyYjs, bodyJson);
      log.info({ pageId: target.id, bytes: bodyYjs.length }, 'persisted collab doc');
    },
  });
}

let serverInstance: Server | null = null;

/** Attach the Hocuspocus WS upgrade to the existing Node HTTP server (dev/in-process).
 *  In prod this same builder can run as a standalone bootstrapped process.
 *
 *  We do NOT use Hocuspocus's own http server; we route only `/collab` upgrade
 *  requests on the app's real server into the Hocuspocus crossws adapter. Other
 *  upgrades (e.g. graphql-sse is HTTP, not WS — so nothing else here) pass through. */
export function attachCollabUpgrade(httpServer: HttpServer): void {
  serverInstance = buildCollabServer();
  const adapter = (serverInstance as unknown as ServerWithCrossws).crossws;

  httpServer.on('upgrade', (request, socket, head) => {
    // Only handle our collab path; let other upgrades (if any) pass untouched.
    if (!request.url || !request.url.startsWith('/collab')) return;
    // A handshake-time rejection must NOT escalate to the global
    // unhandledRejection handler (which process.exit(1)s — see the prior SSE
    // double-close incident). Log + destroy the socket so a hostile or
    // duplicate upgrade can't crash the API process.
    // handleUpgrade may return void or a Promise; normalize so a rejection is caught.
    Promise.resolve(adapter.handleUpgrade(request, socket as Duplex, head)).catch((err: unknown) => {
      log.error({ err: (err as Error)?.message }, 'collab WS upgrade failed');
      try { (socket as Duplex).destroy(); } catch { /* socket already torn down */ }
    });
  });
  log.info('collab WS upgrade attached at /collab');
}

export function getCollabServer(): Server | null { return serverInstance; }
