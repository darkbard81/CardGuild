import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server as HttpServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { WebSocket } from "ws";
import { afterEach, describe, expect, it } from "vitest";

import { PRODUCTION_CONTENT } from "../../src/content";
import type { ClientIntentEnvelope, ServerAck, ServerMessage, ServerSnapshot } from "../../src/protocol";
import type { SessionDurability } from "../../src/server/campaign-durability";
import { restoreCampaignSave } from "../../src/server/campaign-save";
import { digestReconnectToken } from "../../src/server/credentials";
import { createSqlitePersistence, type CampaignSaveRecord, type Persistence } from "../../src/server/persistence";
import { startCardGuildServer, type RunningCardGuildServer } from "../../src/server/server";
import type { SessionCredentialResponse } from "../../src/server/session-store";
import type { SessionIntent } from "../../src/session";
import { createAuthService } from "../../src/server/auth-service";
import { SessionStore } from "../../src/server/session-store";
import { attachWebSocketGateway } from "../../src/server/ws-gateway";

const TEST_ORIGIN = "http://cardguild.test";
const ACCOUNT = { username: "shutdown-host", password: "shutdown host password" };
const PARTY = ["hero.aerin", "hero.lyra", "hero.brom"] as const;
const CONTEXT = { pack: PRODUCTION_CONTENT.pack, adventureId: PRODUCTION_CONTENT.adventureId };

/** Counts and can fail the one call shutdown is allowed to make. */
interface CountingPersistence extends Persistence {
  readonly closeCount: () => number;
  failClose(error: Error | null): void;
}

function counting(inner: Persistence): CountingPersistence {
  let closes = 0;
  let failure: Error | null = null;
  return {
    ...inner,
    closeCount: () => closes,
    failClose(error) {
      failure = error;
    },
    close() {
      closes += 1;
      if (failure) throw failure;
      inner.close();
    },
  };
}

/** A durable write the test can park in flight, which is what a real remote store does. */
interface HeldDurability extends SessionDurability {
  /** Resolves once the first commit is inside the write and waiting. */
  readonly entered: Promise<void>;
  release(): void;
}

function holdFirstCommit(): HeldDurability {
  let announce: (() => void) | undefined;
  const entered = new Promise<void>((resolve) => { announce = resolve; });
  let open: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => { open = resolve; });
  let held = false;
  return {
    entered,
    release: () => open?.(),
    async commitGameplayTransition() {
      if (held) return;
      held = true;
      announce?.();
      await gate;
    },
  };
}

/** Counts the gateway's own lookups, which is how a handler makes itself observable. */
class ObservedStore extends SessionStore {
  public lookups = 0;

  public override get(sessionId: string): ReturnType<SessionStore["get"]> {
    this.lookups += 1;
    return super.get(sessionId);
  }
}

class SocketClient {
  public readonly messages: ServerMessage[] = [];

  private constructor(public readonly socket: WebSocket) {
    socket.on("message", (data) => this.messages.push(JSON.parse(data.toString()) as ServerMessage));
    socket.on("error", () => undefined);
  }

  public static async connect(origin: string, credential: SessionCredentialResponse): Promise<SocketClient> {
    const socket = new WebSocket(origin.replace(/^http/, "ws") + "/ws", { origin: TEST_ORIGIN });
    const client = new SocketClient(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once("open", () => resolve());
      socket.once("error", reject);
    });
    socket.send(JSON.stringify({
      v: 7,
      type: "hello",
      sessionId: credential.sessionId,
      playerId: credential.playerId,
      reconnectToken: credential.reconnectToken,
      contentIdentity: PRODUCTION_CONTENT.contentIdentity,
    }));
    return client;
  }

  public waitFor<T extends ServerMessage>(
    predicate: (message: ServerMessage) => message is T,
    from = 0,
    timeoutMs = 10_000,
  ): Promise<T> {
    const existing = this.messages.slice(from).find(predicate);
    if (existing) return Promise.resolve(existing);
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Timed out: " + JSON.stringify(this.messages.slice(from)))), timeoutMs);
      const listener = (): void => {
        const found = this.messages.slice(from).find(predicate);
        if (!found) return;
        clearTimeout(timeout);
        this.socket.off("message", listener);
        resolve(found);
      };
      this.socket.on("message", listener);
    });
  }

  public send(envelope: ClientIntentEnvelope): void {
    this.socket.send(JSON.stringify(envelope));
  }

  public close(): Promise<void> {
    if (this.socket.readyState === WebSocket.CLOSED) return Promise.resolve();
    return new Promise((resolve) => {
      this.socket.once("close", () => resolve());
      this.socket.close(1000, "test close");
    });
  }
}

describe("M9-5 graceful shutdown", () => {
  const directories: string[] = [];
  const servers: RunningCardGuildServer[] = [];
  const sockets: SocketClient[] = [];

  afterEach(async () => {
    await Promise.all(sockets.splice(0).map((socket) => socket.close()));
    for (const server of servers.splice(0)) await server.close().catch(() => undefined);
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
  });

  function databasePath(): string {
    const directory = mkdtempSync(path.join(tmpdir(), "cardguild-m9-5-shutdown-"));
    directories.push(directory);
    return path.join(directory, "campaigns.sqlite");
  }

  async function start(file: string): Promise<{
    readonly server: RunningCardGuildServer;
    readonly persistence: CountingPersistence;
    readonly internalErrors: unknown[];
  }> {
    const persistence = counting(createSqlitePersistence(file));
    const internalErrors: unknown[] = [];
    const server = await startCardGuildServer({
      context: CONTEXT,
      allowedOrigins: new Set([TEST_ORIGIN]),
      heartbeatMs: 60_000,
      persistence,
      onInternalError: (error) => internalErrors.push(error),
      sources: {
        sessionId: () => "session-" + Math.random().toString(36).slice(2, 10),
        playerId: () => "player-" + Math.random().toString(36).slice(2, 10),
        reconnectCredential: () => {
          const token = "reconnect-" + Math.random().toString(36).slice(2, 12);
          return { token, digest: digestReconnectToken(token) };
        },
        adventureSeed: () => 1,
      },
    });
    servers.push(server);
    return { server, persistence, internalErrors };
  }

  async function seedAccount(file: string): Promise<void> {
    const persistence = createSqlitePersistence(file);
    await createAuthService(persistence).createAccount(ACCOUNT.username, ACCOUNT.password);
    persistence.close();
  }

  async function signIn(origin: string): Promise<string> {
    const response = await fetch(new URL("/api/auth/login", origin), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(ACCOUNT),
    });
    expect(response.status).toBe(200);
    const cookie = response.headers.get("set-cookie")?.split(";")[0];
    if (!cookie) throw new Error("Sign in returned no auth cookie.");
    return cookie;
  }

  async function openCampaign(origin: string, cookie: string): Promise<{
    readonly campaignId: string;
    readonly credential: SessionCredentialResponse;
  }> {
    const response = await fetch(new URL("/api/campaigns", origin), {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ name: "Shutdown Trouble", displayName: "Host" }),
    });
    expect(response.status).toBe(201);
    const body = await response.json() as SessionCredentialResponse & { readonly campaign: { readonly campaignId: string } };
    return { campaignId: body.campaign.campaignId, credential: body };
  }

  function envelope(requestId: string, expectedRevision: number, intent: SessionIntent): ClientIntentEnvelope {
    return { v: 7, type: "intent", requestId, expectedRevision, intent };
  }

  async function play(
    client: SocketClient,
    snapshot: ServerSnapshot,
    requestId: string,
    intent: SessionIntent,
  ): Promise<ServerSnapshot> {
    const mark = client.messages.length;
    client.send(envelope(requestId, snapshot.revision, intent));
    const ack = await client.waitFor(
      (message): message is ServerAck => message.type === "ack" && message.requestId === requestId, mark);
    expect(ack.accepted, requestId).toBe(true);
    return await client.waitFor(
      (message): message is ServerSnapshot => message.type === "snapshot" && message.revision >= ack.committedRevision,
      mark);
  }

  async function playToCombat(client: SocketClient): Promise<ServerSnapshot> {
    let snapshot = await client.waitFor((message): message is ServerSnapshot => message.type === "snapshot");
    snapshot = await play(client, snapshot, "party", { type: "set-party-composition", actorDefinitionIds: [...PARTY] });
    snapshot = await play(client, snapshot, "begin", { type: "begin-adventure" });
    return await play(client, snapshot, "encounter", { type: "start-encounter" });
  }

  /** What the file holds, read the way Continue would read it. */
  function storedSave(file: string, campaignId: string): CampaignSaveRecord {
    const persistence = createSqlitePersistence(file);
    try {
      const owner = persistence.campaigns.listByOwner(
        persistence.accounts.findByUsername(ACCOUNT.username)?.accountId ?? "");
      expect(owner.map((campaign) => campaign.campaignId)).toContain(campaignId);
      const lookup = persistence.campaigns.loadOwnedSave(campaignId, owner[0]?.ownerAccountId ?? "");
      if (lookup.status !== "loaded") throw new Error(`Stored save is ${lookup.status}.`);
      return lookup.record;
    } finally {
      persistence.close();
    }
  }

  it("closes exactly once however many callers ask, concurrently or afterwards", async () => {
    const file = databasePath();
    await seedAccount(file);
    const { server, persistence } = await start(file);
    const cookie = await signIn(server.origin);
    const opened = await openCampaign(server.origin, cookie);
    const client = await SocketClient.connect(server.origin, opened.credential);
    sockets.push(client);
    const midCombat = await playToCombat(client);

    // Both signals can arrive, and an operator can send a second one. Every one of these
    // used to be a second teardown of an already torn-down server.
    const concurrent = [server.close(), server.close(), server.close()];
    await expect(Promise.all(concurrent)).resolves.toEqual([undefined, undefined, undefined]);
    await expect(server.close()).resolves.toBeUndefined();
    expect(persistence.closeCount()).toBe(1);
    servers.splice(servers.indexOf(server), 1);

    // The last committed transition is on disk, in WAL, and restores cleanly.
    const reopened = new DatabaseSync(file);
    expect(reopened.prepare("PRAGMA journal_mode").get()?.["journal_mode"]).toBe("wal");
    reopened.close();
    const record = storedSave(file, opened.campaignId);
    // The plan's clean-shutdown criterion: the last successful COMMIT is what a reopened
    // database holds, and it restores without repair.
    expect(record.snapshotHash).toBe(midCombat.gameplayHash);
    const restored = restoreCampaignSave(record, CONTEXT);
    expect(restored.migration).toBeNull();
    expect(restored.projection.combat).toEqual(midCombat.state.combat);
    expect(restored.projection.adventure).toEqual(midCombat.state.adventure);
  }, 60_000);

  it("refuses new HTTP work and new WebSocket upgrades once shutdown has started", async () => {
    const file = databasePath();
    await seedAccount(file);
    const { server } = await start(file);
    const cookie = await signIn(server.origin);
    const opened = await openCampaign(server.origin, cookie);
    const origin = server.origin;

    await server.close();
    servers.splice(servers.indexOf(server), 1);

    // The listener is closed, so a new connection is refused at the socket. What matters is
    // that it is refused rather than served from a database that is already closed.
    await expect(fetch(new URL("/api/campaigns", origin), { headers: { cookie } })).rejects.toThrow();
    const socket = new WebSocket(origin.replace(/^http/, "ws") + "/ws", { origin: TEST_ORIGIN });
    await expect(new Promise((resolve, reject) => {
      socket.once("open", () => resolve("open"));
      socket.once("error", reject);
    })).rejects.toThrow();
    socket.terminate();
    expect(opened.campaignId).toMatch(/^campaign_/);
  }, 60_000);

  it("leaves nothing half written when messages are still arriving as it goes down", async () => {
    const file = databasePath();
    await seedAccount(file);
    const { server, internalErrors } = await start(file);
    const cookie = await signIn(server.origin);
    const opened = await openCampaign(server.origin, cookie);
    const client = await SocketClient.connect(server.origin, opened.credential);
    sockets.push(client);
    const midCombat = await playToCombat(client);

    // Several intents pipelined onto one socket: whichever ones the gateway has read must
    // reach the database before it closes, and whichever ones it has not are simply dropped.
    // A message handled after the close would write to a closed database and surface here.
    for (let index = 0; index < 4; index += 1) {
      client.send(envelope(`racing-${String(index)}`, midCombat.revision + index, { type: "end-turn", facing: "north" }));
    }
    await server.close();
    servers.splice(servers.indexOf(server), 1);
    expect(internalErrors).toEqual([]);

    const record = storedSave(file, opened.campaignId);
    // Whatever prefix landed is a complete, restorable save — never a torn one.
    const restored = restoreCampaignSave(record, CONTEXT);
    expect(restored.migration).toBeNull();
    expect(restored.projection.adventure.phase).toBe("combat");
  }, 60_000);

  it("reports a failed close to every caller instead of looking clean", async () => {
    const file = databasePath();
    await seedAccount(file);
    const { server, persistence } = await start(file);
    const failure = new Error("database close failed");
    persistence.failClose(failure);

    const first = server.close();
    const second = server.close();
    await expect(first).rejects.toBe(failure);
    // The shared shutdown reports the same failure rather than a false success.
    await expect(second).rejects.toBe(failure);
    expect(persistence.closeCount()).toBe(1);

    persistence.failClose(null);
    servers.splice(servers.indexOf(server), 1);
    persistence.close();
  }, 60_000);

  /**
   * The exact ordering the shutdown contract has to survive: a message is being handled,
   * the client's socket closes first, and shutdown starts immediately after.
   *
   * This is a gateway-level test on purpose. The invariant belongs to the gateway — "close
   * does not return while a message it already accepted is still being handled" — and
   * `server.close()` is built on top of it. It also cannot be reached through the whole
   * server today: nothing in the intent path awaits real I/O, so every accepted message
   * finishes inside the tick that read it and can never still be running when the socket's
   * close event arrives. A durability that talks to anything remote changes that on its
   * first line, which is precisely why this is pinned now rather than after.
   */
  it("waits for a message it already accepted even when that socket closed first", async () => {
    const httpServer: HttpServer = createServer((_request, response) => {
      response.writeHead(404).end();
    });
    const store = new ObservedStore(CONTEXT, {
      sessionId: () => "session-race",
      playerId: () => "player-race",
      reconnectCredential: () => {
        const token = "reconnect-race";
        return { token, digest: digestReconnectToken(token) };
      },
      adventureSeed: () => 1,
    });
    const gateway = attachWebSocketGateway(httpServer, store, {
      allowedOrigins: new Set([TEST_ORIGIN]),
      heartbeatMs: 60_000,
    });
    await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", () => resolve()));
    const address = httpServer.address();
    if (!address || typeof address === "string") throw new Error("The test server did not bind a port.");
    const origin = `http://127.0.0.1:${String(address.port)}`;

    const held = holdFirstCommit();
    const credential = store.create("Host", held);
    const client = await SocketClient.connect(origin, credential);
    const opening = await client.waitFor(
      (message): message is ServerSnapshot => message.type === "snapshot");

    // Two messages down one socket. The first parks inside its durable write, so the second
    // is provably still sitting in the gateway's queue rather than on a SessionHost queue —
    // which is exactly the work `SessionStore.drain()` cannot see.
    client.send(envelope("first", opening.revision, {
      type: "set-party-composition", actorDefinitionIds: [...PARTY],
    }));
    client.send(envelope("second", opening.revision + 1, { type: "begin-adventure" }));
    await held.entered;

    // TCP keeps the order, so the server reads the second message and only then the close.
    await client.close();
    const lookupsBeforeClose = store.lookups;
    await expect.poll(() => store.lookups, { timeout: 10_000 }).toBeGreaterThan(lookupsBeforeClose - 1);
    // Let the close handler land before shutdown starts.
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    const settled = store.lookups;

    let finished = false;
    const closing = gateway.close().then(() => { finished = true; });
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
    // Still holding: the accepted message has not been handled, so close cannot be done.
    expect(finished).toBe(false);
    expect(store.lookups).toBe(settled);

    held.release();
    await closing;
    // The queued message ran to completion before close returned. Tracking it per socket
    // would have dropped it the moment that socket closed, and `store.drain()` — the next
    // step in the shutdown order — would have walked straight past it.
    expect(store.lookups).toBeGreaterThan(settled);

    await store.drain();
    await new Promise<void>((resolve, reject) => httpServer.close((error) => error ? reject(error) : resolve()));
  }, 60_000);
});