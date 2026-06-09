import { Server } from '@hocuspocus/server';
import { Redis } from '@hocuspocus/extension-redis';
import * as Y from 'yjs';
import { Schema } from 'prosemirror-model';
import { prosemirrorJSONToYXmlFragment } from 'y-prosemirror';
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
 * Minimal ProseMirror schema mirroring the TipTap StarterKit (@tiptap/starter-kit
 * 2.27.x) node/mark NAMES used in the editor (DocEditor.tsx) + the custom
 * `embedTask` atom node (embedTaskNode.ts).
 *
 * WHY hand-built (not prosemirror-schema-basic/-list): those packages use
 * snake_case node names (code_block, hard_break, bullet_list, list_item …),
 * but TipTap emits camelCase names in its snapshot JSON (bulletList, listItem,
 * codeBlock, hardBreak, horizontalRule, embedTask). `Node.fromJSON` validates
 * the JSON against the schema by exact node/mark name, so the names MUST match
 * the snapshot. We only need the content model + attrs (NOT toDOM/parseDOM) for
 * JSON→Yjs reconstruction, so the spec is intentionally minimal.
 *
 * Only used as the fallback path when a page has BodyJson but no BodyYjs
 * (i.e. immediately after usp_DocPage_Restore clears BodyYjs). Any node/mark
 * the snapshot contains that this schema omits would throw in fromJSON — that
 * throw is caught in onLoadDocument and degrades to an empty doc rather than
 * crashing the connection.
 */
const docSnapshotSchema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    text: { group: 'inline' },
    heading: {
      group: 'block',
      content: 'inline*',
      attrs: { level: { default: 1 } },
      defining: true,
    },
    blockquote: { group: 'block', content: 'block+', defining: true },
    codeBlock: {
      group: 'block',
      content: 'text*',
      marks: '',
      attrs: { language: { default: null } },
      code: true,
      defining: true,
    },
    bulletList: { group: 'block', content: 'listItem+' },
    orderedList: {
      group: 'block',
      content: 'listItem+',
      attrs: { start: { default: 1 } },
    },
    listItem: { content: 'paragraph block*', defining: true },
    horizontalRule: { group: 'block' },
    hardBreak: { group: 'inline', inline: true, selectable: false },
    // Custom inline-block atom from embedTaskNode.ts — group:'block', atom:true.
    embedTask: {
      group: 'block',
      atom: true,
      selectable: true,
      attrs: { taskId: { default: null } },
    },
  },
  marks: {
    bold: {},
    italic: {},
    strike: {},
    code: {},
    // textStyle is registered by StarterKit (extension-text-style); include it
    // tolerantly so a snapshot carrying it still validates.
    textStyle: { attrs: { color: { default: null } } },
  },
});

/**
 * Reconstruct a Yjs `'prosemirror'` XML fragment from a stored ProseMirror-JSON
 * snapshot, populating the (assumed empty) fragment of `ydoc` IN PLACE.
 *
 * `prosemirrorJSONToYXmlFragment(schema, json, fragment)` runs
 * `Node.fromJSON(schema, json)` then `updateYFragment` into the supplied
 * fragment — which here is `ydoc.getXmlFragment('prosemirror')`, the same named
 * fragment the client (Collaboration.configure field:'prosemirror') and
 * renderSnapshot use. Returns true on success.
 */
export function reseedFromJson(ydoc: Y.Doc, bodyJson: string): boolean {
  const json: unknown = JSON.parse(bodyJson);
  const fragment = ydoc.getXmlFragment('prosemirror');
  prosemirrorJSONToYXmlFragment(docSnapshotSchema, json, fragment);
  return true;
}

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
      const { bodyYjs, bodyJson } = await repo.loadYjs(target.id);
      if (bodyYjs && bodyYjs.length > 0) {
        // Normal path: rehydrate the CRDT from its binary state.
        seedYDoc(data.document, bodyYjs);
      } else if (bodyJson) {
        // Restore path (enhancement 2): usp_DocPage_Restore nulled BodyYjs and
        // set BodyJson to the restored snapshot. Reconstruct the Yjs fragment
        // from JSON so a reconnecting client loads the restored content rather
        // than an empty page. Failure must NOT crash the connection — degrade
        // to an empty doc (the snapshot is still safely persisted in BodyJson).
        try {
          reseedFromJson(data.document, bodyJson);
          log.info({ pageId: target.id }, 'reseeded collab doc from JSON snapshot');
        } catch (err) {
          log.error(
            { pageId: target.id, err: (err as Error)?.message },
            'JSON→Yjs reseed failed; loading empty doc',
          );
        }
      }
      return data.document;
    },

    async onStoreDocument(data): Promise<void> {
      const target = docNameToTarget(data.documentName);
      if (!target) return;
      const bodyYjs = Buffer.from(Y.encodeStateAsUpdate(data.document));
      const bodyJson = renderSnapshot(data.document);
      await repo.persistYjs(target.id, bodyYjs, bodyJson);
      log.info({ pageId: target.id, bytes: bodyYjs.length }, 'persisted collab doc');

      // Enhancement 1 — version checkpoint on store. The author is the
      // connection's authenticated user, surfaced as `lastContext` on the
      // onStoreDocument payload (Hocuspocus v4: onStoreDocumentPayload carries
      // `lastContext: Context`, NOT `context`; Context = the CollabAuthContext
      // returned by onAuthenticate, which has `userId`). GUARD: if no userId is
      // resolvable (e.g. a store fired with no surviving authed connection),
      // SKIP the version insert to avoid violating the CreatedById FK. The
      // insert failure is isolated so it can never fail the persist above.
      const userId = data.lastContext?.userId;
      if (!userId) {
        log.debug({ pageId: target.id }, 'no userId on store context — skipping version checkpoint');
        return;
      }
      try {
        await repo.createVersion(target.id, bodyJson, userId);
        log.info({ pageId: target.id, userId }, 'version checkpoint created on store');
      } catch (err) {
        log.error(
          { pageId: target.id, err: (err as Error)?.message },
          'version checkpoint failed (persist already succeeded)',
        );
      }
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
