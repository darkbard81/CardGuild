import { WebSocket } from "ws";
import { afterEach, describe, expect, it, vi } from "vitest";

import { M4_ADVENTURE_ID, M4_COMPILED_PACK, M4_CONTENT_IDENTITY } from "../../src/content";
import type {
  ClientIntentEnvelope,
  ServerAck,
  ServerError,
  ServerMessage,
  ServerSnapshot,
} from "../../src/protocol";
import { digestReconnectToken } from "../../src/server/credentials";
import { startCardGuildServer, type RunningCardGuildServer } from "../../src/server/server";
import type { SessionCredentialResponse } from "../../src/server/session-store";
import { hashSessionGameplayState, type SessionGameplayIntent } from "../../src/session";

const TEST_ORIGIN = "http://cardguild.test";

class SocketClient {
  public readonly messages: ServerMessage[] = [];
  public readonly socket: WebSocket;

  private constructor(socket: WebSocket) {
    this.socket = socket;
    socket.on("message", (data) => {
      this.messages.push(JSON.parse(data.toString()) as ServerMessage);
    });
  }

  public static async connect(
    origin: string,
    credential: SessionCredentialResponse,
    contentIdentity = M4_CONTENT_IDENTITY,
  ): Promise<SocketClient> {
    const socket = new WebSocket(origin.replace(/^http/, "ws") + "/ws", { origin: TEST_ORIGIN });
    const client = new SocketClient(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once("open", () => resolve());
      socket.once("error", reject);
    });
    socket.send(JSON.stringify({
      v: 1,
      type: "hello",
      sessionId: credential.sessionId,
      playerId: credential.playerId,
      reconnectToken: credential.reconnectToken,
      contentIdentity,
    }));
    return client;
  }

  public mark(): number {
    return this.messages.length;
  }

  public send(envelope: ClientIntentEnvelope): void {
    this.socket.send(JSON.stringify(envelope));
  }

  public waitFor<T extends ServerMessage>(
    predicate: (message: ServerMessage) => message is T,
    from = 0,
    timeoutMs = 5_000,
  ): Promise<T> {
    const existing = this.messages.slice(from).find(predicate);
    if (existing) return Promise.resolve(existing);
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.socket.off("message", listener);
        reject(new Error(`Timed out waiting for message after index ${from}: ${JSON.stringify(this.messages.slice(from))}`));
      }, timeoutMs);
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

  public waitForSnapshot(from = 0, revision?: number): Promise<ServerSnapshot> {
    return this.waitFor(
      (message): message is ServerSnapshot => message.type === "snapshot" &&
        (revision === undefined || message.revision === revision),
      from,
    );
  }

  public close(): Promise<number> {
    if (this.socket.readyState === WebSocket.CLOSED) return Promise.resolve(1000);
    return new Promise((resolve) => {
      this.socket.once("close", (code) => resolve(code));
      this.socket.close(1000, "test close");
    });
  }
}

async function post<T>(origin: string, path: string, body: unknown): Promise<{ readonly status: number; readonly body: T }> {
  const response = await fetch(`${origin}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as T };
}

function intent(requestId: string, expectedRevision: number, value: SessionGameplayIntent): ClientIntentEnvelope {
  return { v: 1, type: "intent", requestId, expectedRevision, intent: value };
}

describe("real WebSocket cooperative session", () => {
  let running: RunningCardGuildServer | null = null;
  const sockets: SocketClient[] = [];

  afterEach(async () => {
    await Promise.all(sockets.splice(0).map((socket) => socket.close()));
    if (running) await running.close();
    running = null;
    vi.restoreAllMocks();
  });

  it("creates, joins, orders, authorizes, converges, and reconnects three real clients", async () => {
    let sessionSequence = 0;
    let playerSequence = 0;
    let tokenSequence = 0;
    running = await startCardGuildServer({
      context: { pack: M4_COMPILED_PACK, adventureId: M4_ADVENTURE_ID, actorDefinitionId: "hero.aerin" },
      allowedOrigins: new Set([TEST_ORIGIN]),
      heartbeatMs: 60_000,
      sources: {
        sessionId: () => `session-${++sessionSequence}`,
        playerId: () => `player-${++playerSequence}`,
        reconnectCredential: () => {
          const token = `reconnect-${++tokenSequence}`;
          return { token, digest: digestReconnectToken(token) };
        },
        adventureSeed: () => 1,
      },
    });

    const created = await post<SessionCredentialResponse & { readonly invite: { readonly sessionId: string } }>(
      running.origin,
      "/api/sessions",
      { displayName: "Host" },
    );
    expect(created.status).toBe(201);
    expect(created.body.invite).toEqual({ sessionId: created.body.sessionId });
    expect(JSON.stringify(created.body.invite)).not.toContain(created.body.reconnectToken);
    const joinedB = await post<SessionCredentialResponse>(running.origin, `/api/sessions/${created.body.sessionId}/join`, { displayName: "B" });
    const joinedC = await post<SessionCredentialResponse>(running.origin, `/api/sessions/${created.body.sessionId}/join`, { displayName: "C" });
    const full = await post<{ readonly code: string }>(running.origin, `/api/sessions/${created.body.sessionId}/join`, { displayName: "D" });
    expect([joinedB.status, joinedC.status, full.status, full.body.code]).toEqual([200, 200, 409, "SESSION_FULL"]);

    const clients = await Promise.all([
      SocketClient.connect(running.origin, created.body),
      SocketClient.connect(running.origin, joinedB.body),
      SocketClient.connect(running.origin, joinedC.body),
    ]);
    sockets.push(...clients);
    const [hostClient, clientB, clientC] = clients as [SocketClient, SocketClient, SocketClient];
    const credentials = [created.body, joinedB.body, joinedC.body] as const;
    const initial = await Promise.all(clients.map((client) => client.waitForSnapshot(0, 2)));
    expect(initial.every((snapshot) => snapshot.state.seats.length === 3)).toBe(true);
    const host = running.store.get(created.body.sessionId) as NonNullable<ReturnType<typeof running.store.get>>;

    const guestMark = clientB.mark();
    clientB.send(intent("guest-begin", 2, { type: "begin-adventure" }));
    const guestError = await clientB.waitFor(
      (message): message is ServerError => message.type === "error" && message.requestId === "guest-begin",
      guestMark,
    );
    expect(guestError.code).toBe("FORBIDDEN");
    expect(host.state.revision).toBe(2);

    const beginEnvelope = intent("host-begin", 2, { type: "begin-adventure" });
    const beginMarks = clients.map((client) => client.mark());
    hostClient.send(beginEnvelope);
    const beginAck = await hostClient.waitFor(
      (message): message is ServerAck => message.type === "ack" && message.requestId === "host-begin",
      beginMarks[0],
    );
    expect(beginAck.accepted).toBe(true);
    await host.whenIdle();
    await Promise.all(clients.map((client, index) => client.waitForSnapshot(beginMarks[index], host.state.revision)));
    expect(host.state.adventure?.party.members).toHaveProperty("party.hero-3");

    const retryRevision = host.state.revision;
    const retryMark = hostClient.mark();
    hostClient.send(beginEnvelope);
    const retryAck = await hostClient.waitFor(
      (message): message is ServerAck => message.type === "ack" && message.requestId === "host-begin",
      retryMark,
    );
    expect(retryAck).toEqual(beginAck);
    await host.whenIdle();
    expect(host.state.revision).toBe(retryRevision);

    const reuseMark = hostClient.mark();
    hostClient.send({ ...beginEnvelope, intent: { type: "start-encounter" } });
    const reuse = await hostClient.waitFor(
      (message): message is ServerError => message.type === "error" && message.code === "REQUEST_ID_REUSE",
      reuseMark,
    );
    expect(reuse.requestId).toBe("host-begin");
    expect(host.state.revision).toBe(retryRevision);

    const concurrentRevision = host.state.revision;
    const markA = hostClient.mark();
    const markB = clientB.mark();
    hostClient.send(intent("loadout-a", concurrentRevision, {
      type: "set-loadout",
      loadout: { equipment: { weapon: "halberd", feet: "boots-of-fly" }, preparedCards: [] },
    }));
    clientB.send(intent("loadout-b", concurrentRevision, {
      type: "set-loadout",
      loadout: { equipment: { weapon: "halberd", feet: "boots-of-fly" }, preparedCards: [] },
    }));
    const [ackA, ackB] = await Promise.all([
      hostClient.waitFor((message): message is ServerAck => message.type === "ack" && message.requestId === "loadout-a", markA),
      clientB.waitFor((message): message is ServerAck => message.type === "ack" && message.requestId === "loadout-b", markB),
    ]);
    expect([ackA.accepted, ackB.accepted].sort()).toEqual([false, true]);
    await host.whenIdle();
    expect(host.state.revision).toBe(concurrentRevision + 1);

    const staleClient = ackA.accepted ? clientB : hostClient;
    const stalePlayer = ackA.accepted ? joinedB.body : created.body;
    const retryLoadoutId = ackA.accepted ? "loadout-b-retry" : "loadout-a-retry";
    const staleMark = staleClient.mark();
    staleClient.send(intent(retryLoadoutId, host.state.revision, {
      type: "set-loadout",
      loadout: { equipment: { weapon: "halberd", feet: "boots-of-fly" }, preparedCards: [] },
    }));
    await staleClient.waitFor(
      (message): message is ServerAck => message.type === "ack" && message.requestId === retryLoadoutId && message.accepted,
      staleMark,
    );
    await host.whenIdle();
    expect(host.state.adventure?.party.members[`party.hero-${stalePlayer.seat}`]?.loadout.equipment.shield).toBeUndefined();

    const cMark = clientC.mark();
    clientC.send(intent("loadout-c", host.state.revision, {
      type: "set-loadout",
      loadout: { equipment: { weapon: "halberd", feet: "boots-of-fly" }, preparedCards: [] },
    }));
    await clientC.waitFor((message): message is ServerAck => message.type === "ack" && message.requestId === "loadout-c" && message.accepted, cMark);
    await host.whenIdle();

    const startMarks = clients.map((client) => client.mark());
    hostClient.send(intent("start-encounter", host.state.revision, { type: "start-encounter" }));
    await hostClient.waitFor(
      (message): message is ServerAck => message.type === "ack" && message.requestId === "start-encounter" && message.accepted,
      startMarks[0],
    );
    await host.whenIdle();
    await Promise.all(clients.map((client, index) => client.waitForSnapshot(startMarks[index], host.state.revision)));
    expect(host.state.combat).not.toBeNull();

    let sawReaction = Boolean(host.state.combat?.pendingReaction);
    let recoveredReactionOwner = false;
    const serverSnapshotCount = (): number => clients.flatMap((client) => client.messages)
      .filter((message) => message.type === "snapshot" && message.cause?.kind === "server").length;
    const initialServerSnapshots = serverSnapshotCount();
    for (let turn = 0; turn < 12 && host.state.combat; turn += 1) {
      const combat = host.state.combat;
      const controlledActorId = combat.pendingReaction?.candidates[0]?.actorId ?? combat.turn.activeActorId;
      const ownerSeat = host.state.seats.find((seat) => seat.memberId === controlledActorId);
      if (!ownerSeat) throw new Error(`Server stopped outside a human boundary at ${controlledActorId}.`);
      if (combat.pendingReaction && !recoveredReactionOwner) {
        const disconnected = clients[ownerSeat.seat - 1] as SocketClient;
        const beforeDisconnect = host.state;
        const beforeHash = hashSessionGameplayState(beforeDisconnect);
        await disconnected.close();
        expect(host.state).toBe(beforeDisconnect);
        const replacement = await SocketClient.connect(
          running.origin,
          credentials[ownerSeat.seat - 1] as SessionCredentialResponse,
        );
        sockets.push(replacement);
        clients[ownerSeat.seat - 1] = replacement;
        const recovered = await replacement.waitForSnapshot(0, beforeDisconnect.revision);
        expect(recovered.state).toEqual(beforeDisconnect);
        expect(recovered.gameplayHash).toBe(beforeHash);
        expect(recovered.state.combat?.pendingReaction).toEqual(combat.pendingReaction);
        expect(recovered.events.length).toBeGreaterThan(0);
        recoveredReactionOwner = true;
      }
      const owner = clients[ownerSeat.seat - 1] as SocketClient;
      const nonOwner = clients[ownerSeat.seat % clients.length] as SocketClient;
      const gameplayIntent: SessionGameplayIntent = combat.pendingReaction
        ? { type: "pass-reaction", triggerId: combat.pendingReaction.triggerId }
        : { type: "end-turn" };
      sawReaction ||= Boolean(combat.pendingReaction);

      const forbiddenId = `forbidden-${turn}`;
      const forbiddenMark = nonOwner.mark();
      nonOwner.send(intent(forbiddenId, host.state.revision, gameplayIntent));
      const forbidden = await nonOwner.waitFor(
        (message): message is ServerError => message.type === "error" && message.requestId === forbiddenId,
        forbiddenMark,
      );
      expect(forbidden.code).toBe("FORBIDDEN");

      const acceptedId = `human-${turn}`;
      const ownerMark = owner.mark();
      owner.send(intent(acceptedId, host.state.revision, gameplayIntent));
      await owner.waitFor(
        (message): message is ServerAck => message.type === "ack" && message.requestId === acceptedId && message.accepted,
        ownerMark,
      );
      await host.whenIdle();
    }
    expect(serverSnapshotCount()).toBeGreaterThan(initialServerSnapshots);
    expect(sawReaction).toBe(true);
    expect(recoveredReactionOwner).toBe(true);

    const finalRevision = host.state.revision;
    const finalHash = host.state.combat ? host.state.combat.setupFingerprint : host.state.adventure?.phase;
    const convergence = await Promise.all(clients.map((client) => client.waitForSnapshot(0, finalRevision)));
    expect(new Set(convergence.map((snapshot) => snapshot.gameplayHash)).size).toBe(1);
    expect(convergence.every((snapshot) => snapshot.state.revision === finalRevision)).toBe(true);

    const beforeDisconnect = host.state;
    await (clients[1] as SocketClient).close();
    expect(host.state).toBe(beforeDisconnect);
    const reconnect = await SocketClient.connect(running.origin, joinedB.body);
    sockets.push(reconnect);
    clients[1] = reconnect;
    const recovered = await reconnect.waitForSnapshot(0, finalRevision);
    expect(recovered.gameplayHash).toBe(convergence[0]?.gameplayHash);
    expect(recovered.state.combat?.setupFingerprint ?? recovered.state.adventure?.phase).toBe(finalHash);
    if (recovered.state.combat) expect(recovered.events.length).toBeGreaterThan(0);

    const replacementClosed = new Promise<number>((resolve) => reconnect.socket.once("close", (code) => resolve(code)));
    const replacement = await SocketClient.connect(running.origin, joinedB.body);
    sockets.push(replacement);
    clients[1] = replacement;
    expect(await replacementClosed).toBe(4001);
    await replacement.waitForSnapshot(0, finalRevision);

    const wrongContent = await SocketClient.connect(running.origin, created.body, {
      ...M4_CONTENT_IDENTITY,
      fingerprint: "fnv1a64:wrong",
    });
    sockets.push(wrongContent);
    const contentFailure = await wrongContent.waitFor(
      (message): message is ServerError => message.type === "error" && message.code === "CONTENT_MISMATCH",
    );
    expect(contentFailure.code).toBe("CONTENT_MISMATCH");
    expect(wrongContent.messages.some((message) => message.type === "snapshot")).toBe(false);

    const wrongToken = await SocketClient.connect(running.origin, { ...created.body, reconnectToken: "wrong" });
    sockets.push(wrongToken);
    const tokenFailure = await wrongToken.waitFor(
      (message): message is ServerError => message.type === "error" && message.code === "UNAUTHENTICATED",
    );
    expect(tokenFailure.code).toBe("UNAUTHENTICATED");

    const invalid = new WebSocket(running.origin.replace(/^http/, "ws") + "/ws", { origin: TEST_ORIGIN });
    await new Promise<void>((resolve) => invalid.once("open", () => resolve()));
    const invalidError = new Promise<ServerError>((resolve) => invalid.on("message", (data) => {
      const message = JSON.parse(data.toString()) as ServerMessage;
      if (message.type === "error") resolve(message);
    }));
    invalid.send("{");
    expect((await invalidError).code).toBe("INVALID_MESSAGE");
    invalid.terminate();

    const oversized = new WebSocket(running.origin.replace(/^http/, "ws") + "/ws", { origin: TEST_ORIGIN });
    await new Promise<void>((resolve) => oversized.once("open", () => resolve()));
    const oversizedClose = new Promise<number>((resolve) => oversized.once("close", (code) => resolve(code)));
    oversized.send("x".repeat(70 * 1024));
    expect(await oversizedClose).toBe(1009);
  }, 30_000);

  it("observes a rejected SessionHost intent and closes only that gateway connection with 1011", async () => {
    const authorityErrors = vi.fn();
    running = await startCardGuildServer({
      context: { pack: M4_COMPILED_PACK, adventureId: M4_ADVENTURE_ID, actorDefinitionId: "hero.aerin" },
      allowedOrigins: new Set([TEST_ORIGIN]),
      heartbeatMs: 60_000,
      onInternalError: authorityErrors,
      sources: {
        sessionId: () => "session-failure-boundary",
        playerId: () => "player-failure-boundary",
        reconnectCredential: () => ({
          token: "reconnect-failure-boundary",
          digest: digestReconnectToken("reconnect-failure-boundary"),
        }),
        adventureSeed: () => 1,
      },
    });
    const created = await post<SessionCredentialResponse>(running.origin, "/api/sessions", { displayName: "Host" });
    const client = await SocketClient.connect(running.origin, created.body);
    sockets.push(client);
    await client.waitForSnapshot(0, 0);
    const host = running.store.get(created.body.sessionId) as NonNullable<ReturnType<typeof running.store.get>>;
    const authorityFailure = new Error("private invariant detail");
    vi.spyOn(host, "handleIntent").mockRejectedValueOnce(authorityFailure);
    const closed = new Promise<{ readonly code: number; readonly reason: string }>((resolve) => {
      client.socket.once("close", (code, reason) => resolve({ code, reason: reason.toString() }));
    });

    client.send(intent("trigger-authority-failure", host.state.revision, { type: "begin-adventure" }));

    await expect(closed).resolves.toEqual({ code: 1011, reason: "session authority failure" });
    expect(authorityErrors).toHaveBeenCalledOnce();
    expect(authorityErrors).toHaveBeenCalledWith(authorityFailure);
    expect(client.messages.some((message) => JSON.stringify(message).includes("private invariant detail"))).toBe(false);
  });
});
