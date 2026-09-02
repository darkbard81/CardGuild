import { WebSocket } from "ws";
import { afterEach, describe, expect, it, vi } from "vitest";

import { M6_ADVENTURE_ID, M6_COMPILED_PACK, M6_CONTENT_IDENTITY } from "../../src/content";
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
import { hashSessionGameplayState, type SessionIntent } from "../../src/session";

const TEST_ORIGIN = "http://cardguild.test";
const PARTY = ["hero.aerin", "hero.lyra", "hero.brom"] as const;
const REACTION_PARTY = ["hero.brom", "hero.aerin", "hero.lyra"] as const;

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
    contentIdentity = M6_CONTENT_IDENTITY,
    version: 1 | 3 = 3,
  ): Promise<SocketClient> {
    const socket = new WebSocket(origin.replace(/^http/, "ws") + "/ws", { origin: TEST_ORIGIN });
    const client = new SocketClient(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once("open", () => resolve());
      socket.once("error", reject);
    });
    socket.send(JSON.stringify({
      v: version,
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
        reject(new Error(
          "Timed out waiting after index " + String(from) + ": " + JSON.stringify(this.messages.slice(from)),
        ));
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

  public waitForSnapshot(
    from = 0,
    predicate: (snapshot: ServerSnapshot) => boolean = () => true,
  ): Promise<ServerSnapshot> {
    return this.waitFor(
      (message): message is ServerSnapshot => message.type === "snapshot" && predicate(message),
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

async function post<T>(
  origin: string,
  path: string,
  body: unknown,
): Promise<{ readonly status: number; readonly body: T }> {
  const response = await fetch(origin + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as T };
}

function envelope(requestId: string, expectedRevision: number, value: SessionIntent): ClientIntentEnvelope {
  return { v: 3, type: "intent", requestId, expectedRevision, intent: value };
}

async function accepted(
  client: SocketClient,
  host: NonNullable<ReturnType<RunningCardGuildServer["store"]["get"]>>,
  requestId: string,
  value: SessionIntent,
): Promise<ServerAck> {
  const mark = client.mark();
  client.send(envelope(requestId, host.state.revision, value));
  const ack = await client.waitFor(
    (message): message is ServerAck => message.type === "ack" && message.requestId === requestId,
    mark,
  );
  expect(ack.accepted).toBe(true);
  await host.whenIdle();
  return ack;
}

async function rejected(
  client: SocketClient,
  host: NonNullable<ReturnType<RunningCardGuildServer["store"]["get"]>>,
  requestId: string,
  value: SessionIntent,
): Promise<ServerError> {
  const mark = client.mark();
  client.send(envelope(requestId, host.state.revision, value));
  const error = await client.waitFor(
    (message): message is ServerError => message.type === "error" && message.requestId === requestId,
    mark,
  );
  await host.whenIdle();
  return error;
}

describe("real WebSocket M5 cooperative session", () => {
  let running: RunningCardGuildServer | null = null;
  const sockets: SocketClient[] = [];

  async function start(): Promise<RunningCardGuildServer> {
    let sessionSequence = 0;
    let playerSequence = 0;
    let tokenSequence = 0;
    running = await startCardGuildServer({
      context: { pack: M6_COMPILED_PACK, adventureId: M6_ADVENTURE_ID },
      allowedOrigins: new Set([TEST_ORIGIN]),
      heartbeatMs: 60_000,
      sources: {
        sessionId: () => "session-" + String(++sessionSequence),
        playerId: () => "player-" + String(++playerSequence),
        reconnectCredential: () => {
          const token = "reconnect-" + String(++tokenSequence);
          return { token, digest: digestReconnectToken(token) };
        },
        adventureSeed: () => 1,
      },
    });
    return running;
  }

  async function create(server: RunningCardGuildServer): Promise<SessionCredentialResponse> {
    const result = await post<SessionCredentialResponse>(
      server.origin,
      "/api/sessions",
      { displayName: "Host" },
    );
    expect(result.status).toBe(201);
    return result.body;
  }

  afterEach(async () => {
    await Promise.all(sockets.splice(0).map((socket) => socket.close()));
    if (running) await running.close();
    running = null;
    vi.restoreAllMocks();
  });

  it("runs a 1P session with the host controlling and editing all three characters", async () => {
    const server = await start();
    const credential = await create(server);
    const client = await SocketClient.connect(server.origin, credential);
    sockets.push(client);
    const initial = await client.waitForSnapshot(0, (snapshot) => snapshot.revision === 0);
    expect(initial.controlRevision).toBe(1);
    const host = server.store.get(credential.sessionId) as NonNullable<ReturnType<typeof server.store.get>>;

    await accepted(client, host, "party", {
      type: "set-party-composition",
      actorDefinitionIds: PARTY,
    });
    expect(host.state.partySlots.map((slot) => slot.actorDefinitionId)).toEqual(PARTY);
    expect(host.control.effectiveControllerByMemberId).toEqual({
      "party.hero-1": credential.playerId,
      "party.hero-2": credential.playerId,
      "party.hero-3": credential.playerId,
    });

    await accepted(client, host, "begin", { type: "begin-adventure" });
    for (const memberId of ["party.hero-1", "party.hero-2", "party.hero-3"]) {
      const member = host.state.adventure?.party.members[memberId];
      expect(member).toBeDefined();
      await accepted(client, host, "loadout-" + memberId, {
        type: "set-loadout",
        memberId,
        loadout: member?.loadout as NonNullable<typeof member>["loadout"],
      });
    }
    await accepted(client, host, "encounter", { type: "start-encounter" });
    expect(Object.keys(host.state.combat?.actors ?? {}).filter((id) => id.startsWith("party.hero-"))).toHaveLength(3);
    const actionable = host.state.combat?.pendingReaction?.candidates[0]?.actorId ??
      host.state.combat?.turn.activeActorId;
    expect(actionable && host.control.effectiveControllerByMemberId[actionable]).toBe(credential.playerId);
  });

  it("recovers a lobby after an HTTP-joined guest never attaches a WebSocket", async () => {
    const server = await start();
    const hostCredential = await create(server);
    const hostClient = await SocketClient.connect(server.origin, hostCredential);
    sockets.push(hostClient);
    await hostClient.waitForSnapshot();
    const host = server.store.get(hostCredential.sessionId) as NonNullable<ReturnType<typeof server.store.get>>;
    await accepted(hostClient, host, "party", {
      type: "set-party-composition",
      actorDefinitionIds: PARTY,
    });
    const partyHash = hashSessionGameplayState(host.state);

    const orphan = await post<SessionCredentialResponse>(
      server.origin,
      "/api/sessions/" + hostCredential.sessionId + "/join",
      { displayName: "Never Attached" },
    );
    expect(orphan.status).toBe(200);
    expect(host.state.seats.map((seat) => seat.playerId)).toEqual([
      hostCredential.playerId,
      orphan.body.playerId,
    ]);
    expect(host.control.connectedPlayerIds).toEqual([hostCredential.playerId]);
    expect(hashSessionGameplayState(host.state)).toBe(partyHash);
    expect((await rejected(hostClient, host, "blocked-begin", { type: "begin-adventure" })).code).toBe(
      "FORBIDDEN",
    );

    await accepted(hostClient, host, "remove-orphan", {
      type: "remove-offline-guest",
      playerId: orphan.body.playerId,
    });
    expect(host.state.seats).toEqual([
      { seat: 1, playerId: hostCredential.playerId, displayName: "Host" },
    ]);
    expect(hashSessionGameplayState(host.state)).toBe(partyHash);

    const revoked = await SocketClient.connect(server.origin, orphan.body);
    sockets.push(revoked);
    expect((await revoked.waitFor(
      (message): message is ServerError => message.type === "error" && message.code === "UNAUTHENTICATED",
    )).code).toBe("UNAUTHENTICATED");
    expect(revoked.messages.some((message) => message.type === "snapshot")).toBe(false);

    await accepted(hostClient, host, "begin-after-cleanup", { type: "begin-adventure" });
    expect(host.state.lifecycle).toBe("active");
    expect(Object.keys(host.state.adventure?.party.members ?? {})).toHaveLength(3);
    expect(host.control.effectiveControllerByMemberId).toEqual({
      "party.hero-1": hostCredential.playerId,
      "party.hero-2": hostCredential.playerId,
      "party.hero-3": hostCredential.playerId,
    });
  });

  it("returns SESSION_FULL when a full prepared party has a hole in player seat numbers", async () => {
    const server = await start();
    const hostCredential = await create(server);
    const hostClient = await SocketClient.connect(server.origin, hostCredential);
    sockets.push(hostClient);
    await hostClient.waitForSnapshot();
    const host = server.store.get(hostCredential.sessionId) as NonNullable<ReturnType<typeof server.store.get>>;

    const joinedB = await post<SessionCredentialResponse>(
      server.origin,
      "/api/sessions/" + hostCredential.sessionId + "/join",
      { displayName: "Guest B" },
    );
    const joinedC = await post<SessionCredentialResponse>(
      server.origin,
      "/api/sessions/" + hostCredential.sessionId + "/join",
      { displayName: "Guest C" },
    );
    expect([joinedB.status, joinedC.status]).toEqual([200, 200]);

    await accepted(hostClient, host, "remove-middle-seat", {
      type: "remove-offline-guest",
      playerId: joinedB.body.playerId,
    });
    await accepted(hostClient, host, "prepare-two", {
      type: "set-party-composition",
      actorDefinitionIds: PARTY.slice(0, 2),
    });
    expect(host.state.seats.map((seat) => seat.seat)).toEqual([1, 3]);

    const full = await post<{ readonly code: string; readonly message: string }>(
      server.origin,
      "/api/sessions/" + hostCredential.sessionId + "/join",
      { displayName: "Guest D" },
    );

    expect(full.status).toBe(409);
    expect(full.body.code).toBe("SESSION_FULL");
    expect(host.state.seats.map((seat) => seat.seat)).toEqual([1, 3]);
  });

  it("falls a guest character back to host without gameplay mutation and restores the claim on reconnect", async () => {
    const server = await start();
    const hostCredential = await create(server);
    const hostClient = await SocketClient.connect(server.origin, hostCredential);
    sockets.push(hostClient);
    await hostClient.waitForSnapshot();
    const host = server.store.get(hostCredential.sessionId) as NonNullable<ReturnType<typeof server.store.get>>;
    await accepted(hostClient, host, "party", {
      type: "set-party-composition",
      actorDefinitionIds: REACTION_PARTY,
    });

    const joined = await post<SessionCredentialResponse>(
      server.origin,
      "/api/sessions/" + hostCredential.sessionId + "/join",
      { displayName: "Guest B" },
    );
    expect(joined.status).toBe(200);
    const guestClient = await SocketClient.connect(server.origin, joined.body);
    sockets.push(guestClient);
    await guestClient.waitForSnapshot();
    await accepted(guestClient, host, "claim", { type: "select-character", memberId: "party.hero-2" });
    expect(host.control.effectiveControllerByMemberId["party.hero-2"]).toBe(joined.body.playerId);

    await accepted(hostClient, host, "begin", { type: "begin-adventure" });
    const guestLoadout = host.state.adventure?.party.members["party.hero-2"]?.loadout;
    expect(guestLoadout).toBeDefined();
    expect((await rejected(hostClient, host, "host-steal", {
      type: "set-loadout",
      memberId: "party.hero-2",
      loadout: guestLoadout as NonNullable<typeof guestLoadout>,
    })).code).toBe("FORBIDDEN");
    await accepted(guestClient, host, "guest-loadout", {
      type: "set-loadout",
      memberId: "party.hero-2",
      loadout: guestLoadout as NonNullable<typeof guestLoadout>,
    });

    await accepted(hostClient, host, "encounter", { type: "start-encounter" });
    for (let index = 0; index < 48; index += 1) {
      const combat = host.state.combat;
      if (!combat) throw new Error("Combat ended before reaching the guest reaction boundary.");
      if (combat.pendingReaction?.candidates[0]?.actorId === "party.hero-2") break;
      const actorId = combat.pendingReaction?.candidates[0]?.actorId ?? combat.turn.activeActorId;
      const controller = host.control.effectiveControllerByMemberId[actorId];
      const ownerClient = controller === hostCredential.playerId ? hostClient : guestClient;
      await accepted(ownerClient, host, "advance-" + String(index), combat.pendingReaction
        ? { type: "pass-reaction", triggerId: combat.pendingReaction.triggerId }
        : { type: "end-turn" });
    }
    const boundaryCombat = host.state.combat;
    const boundaryReaction = boundaryCombat?.pendingReaction;
    expect(boundaryReaction?.candidates[0]?.actorId).toBe("party.hero-2");

    const beforeState = host.state;
    const beforeHash = hashSessionGameplayState(beforeState);
    const beforeRevision = beforeState.revision;
    const beforeControlRevision = host.controlRevision;
    const hostMark = hostClient.mark();
    await guestClient.close();
    await host.whenIdle();
    const fallback = await hostClient.waitForSnapshot(
      hostMark,
      (snapshot) => snapshot.cause?.kind === "control" &&
        snapshot.controlRevision === beforeControlRevision + 1,
    );
    expect(fallback.events).toEqual([]);
    expect(fallback.revision).toBe(beforeRevision);
    expect(fallback.gameplayHash).toBe(beforeHash);
    expect(fallback.state).toEqual(beforeState);
    expect(fallback.control.effectiveControllerByMemberId["party.hero-2"]).toBe(hostCredential.playerId);

    const beforeResolveReconnect = await SocketClient.connect(server.origin, joined.body);
    sockets.push(beforeResolveReconnect);
    const recoveredBeforeResolve = await beforeResolveReconnect.waitForSnapshot(
      0,
      (snapshot) => snapshot.cause?.kind === "resync",
    );
    await host.whenIdle();
    expect(recoveredBeforeResolve.revision).toBe(beforeRevision);
    expect(recoveredBeforeResolve.gameplayHash).toBe(beforeHash);
    expect(recoveredBeforeResolve.state.combat?.pendingReaction?.triggerId).toBe(boundaryReaction?.triggerId);
    expect(recoveredBeforeResolve.control.effectiveControllerByMemberId["party.hero-2"]).toBe(
      joined.body.playerId,
    );
    expect((await rejected(hostClient, host, "host-reaction-while-guest-online", {
      type: "pass-reaction",
      triggerId: boundaryReaction?.triggerId ?? "",
    })).code).toBe("FORBIDDEN");

    const secondFallbackRevision = host.controlRevision;
    const secondHostMark = hostClient.mark();
    await beforeResolveReconnect.close();
    await host.whenIdle();
    const secondFallback = await hostClient.waitForSnapshot(
      secondHostMark,
      (snapshot) => snapshot.cause?.kind === "control" &&
        snapshot.controlRevision === secondFallbackRevision + 1,
    );
    expect(secondFallback.events).toEqual([]);
    expect(secondFallback.revision).toBe(beforeRevision);
    expect(secondFallback.gameplayHash).toBe(beforeHash);
    expect(secondFallback.control.effectiveControllerByMemberId["party.hero-2"]).toBe(
      hostCredential.playerId,
    );

    await accepted(hostClient, host, "fallback-reaction", {
      type: "pass-reaction",
      triggerId: boundaryReaction?.triggerId ?? "",
    });

    const reconnect = await SocketClient.connect(server.origin, joined.body);
    sockets.push(reconnect);
    const recovered = await reconnect.waitForSnapshot(
      0,
      (snapshot) => snapshot.cause?.kind === "resync",
    );
    expect(recovered.state.guestClaims.byMemberId["party.hero-2"]).toBe(joined.body.playerId);
    expect(recovered.control.effectiveControllerByMemberId["party.hero-2"]).toBe(joined.body.playerId);
    expect(recovered.revision).toBe(host.state.revision);
    expect(recovered.gameplayHash).toBe(hashSessionGameplayState(host.state));
  }, 30_000);

  it("serializes a 3P claim race, assigns one character each, and converges every client", async () => {
    const server = await start();
    const hostCredential = await create(server);
    const hostClient = await SocketClient.connect(server.origin, hostCredential);
    sockets.push(hostClient);
    await hostClient.waitForSnapshot();
    const host = server.store.get(hostCredential.sessionId) as NonNullable<ReturnType<typeof server.store.get>>;
    await accepted(hostClient, host, "party", { type: "set-party-composition", actorDefinitionIds: PARTY });

    const joinedB = await post<SessionCredentialResponse>(
      server.origin,
      "/api/sessions/" + hostCredential.sessionId + "/join",
      { displayName: "Guest B" },
    );
    const joinedC = await post<SessionCredentialResponse>(
      server.origin,
      "/api/sessions/" + hostCredential.sessionId + "/join",
      { displayName: "Guest C" },
    );
    expect([joinedB.status, joinedC.status]).toEqual([200, 200]);
    const clientB = await SocketClient.connect(server.origin, joinedB.body);
    const clientC = await SocketClient.connect(server.origin, joinedC.body);
    sockets.push(clientB, clientC);
    await Promise.all([clientB.waitForSnapshot(), clientC.waitForSnapshot()]);

    const raceRevision = host.state.revision;
    const markB = clientB.mark();
    const markC = clientC.mark();
    clientB.send(envelope("race-b", raceRevision, { type: "select-character", memberId: "party.hero-2" }));
    clientC.send(envelope("race-c", raceRevision, { type: "select-character", memberId: "party.hero-2" }));
    const [ackB, ackC] = await Promise.all([
      clientB.waitFor(
        (message): message is ServerAck => message.type === "ack" && message.requestId === "race-b",
        markB,
      ),
      clientC.waitFor(
        (message): message is ServerAck => message.type === "ack" && message.requestId === "race-c",
        markC,
      ),
    ]);
    await host.whenIdle();
    expect([ackB.accepted, ackC.accepted].sort()).toEqual([false, true]);
    const winnerId = host.state.guestClaims.byMemberId["party.hero-2"];
    const loserClient = winnerId === joinedB.body.playerId ? clientC : clientB;
    const loserPlayerId = winnerId === joinedB.body.playerId ? joinedC.body.playerId : joinedB.body.playerId;
    await accepted(loserClient, host, "claim-other", { type: "select-character", memberId: "party.hero-3" });
    expect(new Set(Object.values(host.state.guestClaims.byMemberId))).toEqual(
      new Set([winnerId, loserPlayerId]),
    );

    await accepted(hostClient, host, "begin", { type: "begin-adventure" });
    expect(host.control.effectiveControllerByMemberId).toEqual({
      "party.hero-1": hostCredential.playerId,
      "party.hero-2": winnerId,
      "party.hero-3": loserPlayerId,
    });
    const clients = [hostClient, clientB, clientC];
    const marks = clients.map((client) => client.mark());
    await accepted(hostClient, host, "encounter", { type: "start-encounter" });
    const snapshots = await Promise.all(clients.map((client, index) => client.waitForSnapshot(
      marks[index],
      (snapshot) => snapshot.revision === host.state.revision,
    )));
    expect(new Set(snapshots.map((snapshot) => snapshot.gameplayHash)).size).toBe(1);
    expect(snapshots.every((snapshot) => snapshot.state.revision === host.state.revision)).toBe(true);

    const v1 = await SocketClient.connect(server.origin, hostCredential, M6_CONTENT_IDENTITY, 1);
    sockets.push(v1);
    const mismatch = await v1.waitFor(
      (message): message is ServerError => message.type === "error" && message.code === "PROTOCOL_MISMATCH",
    );
    expect(mismatch.code).toBe("PROTOCOL_MISMATCH");
  }, 30_000);

  it("preserves request, credential, payload, and newest-connection transport boundaries", async () => {
    const server = await start();
    const credential = await create(server);
    const client = await SocketClient.connect(server.origin, credential);
    sockets.push(client);
    await client.waitForSnapshot();
    const host = server.store.get(credential.sessionId) as NonNullable<ReturnType<typeof server.store.get>>;
    let originalConnectionId: string | undefined;
    const handleIntent = host.handleIntent.bind(host);
    vi.spyOn(host, "handleIntent").mockImplementation((playerId, connectionId, value) => {
      originalConnectionId ??= connectionId;
      return handleIntent(playerId, connectionId, value);
    });

    const partyEnvelope = envelope("idempotent-party", 0, {
      type: "set-party-composition",
      actorDefinitionIds: PARTY,
    });
    const firstMark = client.mark();
    client.send(partyEnvelope);
    const firstAck = await client.waitFor(
      (message): message is ServerAck => message.type === "ack" && message.requestId === "idempotent-party",
      firstMark,
    );
    await host.whenIdle();
    expect(firstAck.accepted).toBe(true);
    expect(host.state.revision).toBe(1);

    const retryMark = client.mark();
    client.send(partyEnvelope);
    const retryAck = await client.waitFor(
      (message): message is ServerAck => message.type === "ack" && message.requestId === "idempotent-party",
      retryMark,
    );
    await host.whenIdle();
    expect(retryAck).toEqual(firstAck);
    expect(host.state.revision).toBe(1);

    const reuseMark = client.mark();
    client.send({ ...partyEnvelope, intent: { type: "begin-adventure" } });
    expect((await client.waitFor(
      (message): message is ServerError => message.type === "error" && message.code === "REQUEST_ID_REUSE",
      reuseMark,
    )).requestId).toBe("idempotent-party");
    expect(host.state.revision).toBe(1);

    const staleMark = client.mark();
    client.send(envelope("stale-party", 0, { type: "set-party-composition", actorDefinitionIds: PARTY }));
    expect((await client.waitFor(
      (message): message is ServerError => message.type === "error" && message.code === "STALE_REVISION",
      staleMark,
    )).revision).toBe(1);

    const controlRevision = host.controlRevision;
    const replacedClose = new Promise<number>((resolve) => client.socket.once("close", (code) => resolve(code)));
    const replacement = await SocketClient.connect(server.origin, credential);
    sockets.push(replacement);
    const replacementSnapshot = await replacement.waitForSnapshot(
      0,
      (snapshot) => snapshot.cause?.kind === "resync",
    );
    expect(await replacedClose).toBe(4001);
    await host.whenIdle();
    expect(host.controlRevision).toBe(controlRevision);
    expect(replacementSnapshot.control.effectiveControllerByMemberId).toEqual({
      "party.hero-1": credential.playerId,
      "party.hero-2": credential.playerId,
      "party.hero-3": credential.playerId,
    });
    expect(originalConnectionId).toBeDefined();
    const beforeReplacedIntent = host.state;
    const replacementMark = replacement.mark();
    await host.handleIntent(
      credential.playerId,
      originalConnectionId as string,
      envelope("connection-boundary", beforeReplacedIntent.revision, { type: "begin-adventure" }),
    );
    await host.whenIdle();
    expect(host.state).toBe(beforeReplacedIntent);
    expect(replacement.messages.slice(replacementMark)).toEqual([]);
    await accepted(replacement, host, "connection-boundary", { type: "begin-adventure" });
    expect(host.state.lifecycle).toBe("active");

    const wrongContent = await SocketClient.connect(server.origin, credential, {
      ...M6_CONTENT_IDENTITY,
      fingerprint: "fnv1a64:wrong",
    });
    sockets.push(wrongContent);
    const contentFailure = await wrongContent.waitFor(
      (message): message is ServerError => message.type === "error" && message.code === "CONTENT_MISMATCH",
    );
    expect(contentFailure.code).toBe("CONTENT_MISMATCH");
    expect(wrongContent.messages.some((message) => message.type === "snapshot")).toBe(false);

    const wrongToken = await SocketClient.connect(server.origin, { ...credential, reconnectToken: "wrong" });
    sockets.push(wrongToken);
    expect((await wrongToken.waitFor(
      (message): message is ServerError => message.type === "error" && message.code === "UNAUTHENTICATED",
    )).code).toBe("UNAUTHENTICATED");

    const invalid = new WebSocket(server.origin.replace(/^http/, "ws") + "/ws", { origin: TEST_ORIGIN });
    await new Promise<void>((resolve) => invalid.once("open", () => resolve()));
    const invalidError = new Promise<ServerError>((resolve) => invalid.on("message", (data) => {
      const message = JSON.parse(data.toString()) as ServerMessage;
      if (message.type === "error") resolve(message);
    }));
    invalid.send("{");
    expect((await invalidError).code).toBe("INVALID_MESSAGE");
    invalid.terminate();

    const oversized = new WebSocket(server.origin.replace(/^http/, "ws") + "/ws", { origin: TEST_ORIGIN });
    await new Promise<void>((resolve) => oversized.once("open", () => resolve()));
    const oversizedClose = new Promise<number>((resolve) => oversized.once("close", (code) => resolve(code)));
    oversized.send("x".repeat(70 * 1024));
    expect(await oversizedClose).toBe(1009);
  }, 30_000);

  it("closes only a connection whose queued authority handler rejects", async () => {
    const authorityErrors = vi.fn();
    running = await startCardGuildServer({
      context: { pack: M6_COMPILED_PACK, adventureId: M6_ADVENTURE_ID },
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
    await client.waitForSnapshot();
    const host = running.store.get(created.body.sessionId) as NonNullable<ReturnType<typeof running.store.get>>;
    const authorityFailure = new Error("private invariant detail");
    vi.spyOn(host, "handleIntent").mockRejectedValueOnce(authorityFailure);
    const closed = new Promise<{ readonly code: number; readonly reason: string }>((resolve) => {
      client.socket.once("close", (code, reason) => resolve({ code, reason: reason.toString() }));
    });
    client.send(envelope("trigger-authority-failure", host.state.revision, {
      type: "set-party-composition",
      actorDefinitionIds: PARTY,
    }));
    await expect(closed).resolves.toEqual({ code: 1011, reason: "session authority failure" });
    expect(authorityErrors).toHaveBeenCalledOnce();
    expect(authorityErrors).toHaveBeenCalledWith(authorityFailure);
    expect(client.messages.some((message) => JSON.stringify(message).includes("private invariant detail"))).toBe(false);
  });
});
