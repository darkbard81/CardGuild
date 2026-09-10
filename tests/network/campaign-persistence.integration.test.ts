import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import { PRODUCTION_CONTENT } from "../../src/content";
import type { ServerError, ServerSnapshot } from "../../src/protocol";
import { createAuthService } from "../../src/server/auth-service";
import { digestReconnectToken } from "../../src/server/credentials";
import { createSqlitePersistence, type Persistence } from "../../src/server/persistence";
import { startCardGuildServer, type RunningCardGuildServer } from "../../src/server/server";
import type { SessionCredentialResponse } from "../../src/server/session-store";
import {
  dispatchSessionIntent,
  hashSessionGameplayState,
  type SessionControlContext,
  type SessionCoreState,
  type SessionIntent,
} from "../../src/session";
import { startFaultServer, type FaultChild } from "./fault-child";
import { SocketClient, TEST_ORIGIN, envelope, play } from "./socket-client";

const PARTY = ["hero.aerin", "hero.lyra", "hero.brom"] as const;
const ACCOUNT = { username: "durable-host", password: "durable host password" };
const CONTEXT = { pack: PRODUCTION_CONTENT.pack, adventureId: PRODUCTION_CONTENT.adventureId };

async function signIn(origin: string): Promise<string> {
  const response = await fetch(new URL("/api/auth/login", origin), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(ACCOUNT),
  });
  if (!response.ok) throw new Error(`Sign in failed with ${String(response.status)}.`);
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("Sign in returned no auth cookie.");
  return cookie;
}

async function api<T>(
  origin: string,
  cookie: string,
  method: string,
  path_: string,
  body?: unknown,
): Promise<{ readonly status: number; readonly body: T }> {
  const response = await fetch(new URL(path_, origin), {
    method,
    headers: body === undefined ? { cookie } : { cookie, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as T };
}

interface CampaignSummary {
  readonly campaignId: string;
  readonly name: string;
  readonly hasSave: boolean;
}

function hostControl(state: SessionCoreState): SessionControlContext {
  return {
    connectedPlayerIds: [state.hostPlayerId],
    effectiveControllerByMemberId: Object.fromEntries(
      state.partySlots.map((slot) => [slot.memberId, state.hostPlayerId]),
    ),
  };
}

/** What the pure authority would have produced, used to predict a save the client never saw. */
function nextState(state: SessionCoreState, intent: SessionIntent): SessionCoreState {
  const result = dispatchSessionIntent(state, state.hostPlayerId, intent, CONTEXT, hostControl(state));
  if (!result.accepted) throw new Error("Predicted intent was rejected: " + (result.error ?? ""));
  return result.state;
}

describe("M9-3 durable campaign save over a real file database", () => {
  const directories: string[] = [];
  const servers: RunningCardGuildServer[] = [];
  const stores: Persistence[] = [];
  const sockets: SocketClient[] = [];
  const children: FaultChild[] = [];

  afterEach(async () => {
    await Promise.all(sockets.splice(0).map((socket) => socket.close()));
    // Killed children are already gone; the wait is what keeps a survivor from holding the
    // database open while the next test's temporary directory is removed.
    for (const child of children.splice(0)) await child.stop(["SIGKILL"]);
    for (const server of servers.splice(0)) await server.close();
    stores.splice(0);
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
  });

  function databasePath(): string {
    const directory = mkdtempSync(path.join(tmpdir(), "cardguild-m9-3-net-"));
    directories.push(directory);
    return path.join(directory, "campaigns.sqlite");
  }

  function markerPath(file: string): string {
    return path.join(path.dirname(file), "fault-marker.json");
  }

  async function startServer(file: string): Promise<RunningCardGuildServer> {
    const persistence = createSqlitePersistence(file);
    stores.push(persistence);
    const server = await startCardGuildServer({
      context: CONTEXT,
      allowedOrigins: new Set([TEST_ORIGIN]),
      heartbeatMs: 60_000,
      persistence,
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
    return server;
  }

  async function seedAccount(file: string): Promise<void> {
    const persistence = createSqlitePersistence(file);
    await createAuthService(persistence).createAccount(ACCOUNT.username, ACCOUNT.password);
    persistence.close();
  }

  async function startChild(file: string): Promise<FaultChild> {
    const child = await startFaultServer({
      databasePath: file,
      markerPath: markerPath(file),
      origin: TEST_ORIGIN,
    });
    children.push(child);
    return child;
  }

  async function openCampaign(origin: string, cookie: string): Promise<{
    readonly campaignId: string;
    readonly credential: SessionCredentialResponse;
  }> {
    const created = await api<SessionCredentialResponse & { readonly campaign: CampaignSummary }>(
      origin, cookie, "POST", "/api/campaigns", { name: "Durable Trouble", displayName: "Host" },
    );
    expect(created.status).toBe(201);
    return { campaignId: created.body.campaign.campaignId, credential: created.body };
  }

  /** Prepare, begin and start an encounter, returning the last snapshot the host saw. */
  async function playToCombat(client: SocketClient): Promise<ServerSnapshot> {
    let snapshot = await client.snapshot();
    snapshot = await play(client, snapshot, "party", { type: "set-party-composition", actorDefinitionIds: [...PARTY] });
    snapshot = await play(client, snapshot, "begin", { type: "begin-adventure" });
    return await play(client, snapshot, "encounter", { type: "start-encounter" });
  }

  it("recovers the last committed campaign into a fresh session after the server restarts", async () => {
    const file = databasePath();
    await seedAccount(file);
    const first = await startServer(file);
    const cookie = await signIn(first.origin);
    const opened = await openCampaign(first.origin, cookie);
    const client = await SocketClient.connect(first.origin, opened.credential);
    sockets.push(client);
    const midCombat = await playToCombat(client);
    const savedHash = midCombat.gameplayHash;
    await client.close();
    sockets.pop();
    // Close the whole server, which drains the host queues and then closes the database.
    await first.close();
    servers.splice(servers.indexOf(first), 1);

    // A brand new server on the same file is the only thing that carries the campaign over.
    const database = new DatabaseSync(file);
    expect(database.prepare("PRAGMA journal_mode").get()?.["journal_mode"]).toBe("wal");
    database.close();
    const second = await startServer(file);
    const secondCookie = await signIn(second.origin);
    const listed = await api<{ readonly campaigns: readonly CampaignSummary[] }>(
      second.origin, secondCookie, "GET", "/api/campaigns");
    expect(listed.body.campaigns).toHaveLength(1);
    expect(listed.body.campaigns[0]?.hasSave).toBe(true);

    const continued = await api<SessionCredentialResponse>(
      second.origin, secondCookie, "POST", `/api/campaigns/${opened.campaignId}/continue`, {});
    expect(continued.status).toBe(200);
    expect(continued.body.sessionId).not.toBe(opened.credential.sessionId);
    expect(continued.body.playerId).not.toBe(opened.credential.playerId);
    expect(continued.body.reconnectToken).not.toBe(opened.credential.reconnectToken);

    const resumed = await SocketClient.connect(second.origin, continued.body);
    sockets.push(resumed);
    const restored = await resumed.snapshot();
    expect(restored.state.lifecycle).toBe("resume-lobby");
    expect(restored.state.revision).toBe(0);
    expect(restored.state.guestClaims).toEqual({ byMemberId: {} });
    expect(restored.gameplayHash).toBe(savedHash);
    // Every field the exit criterion names, compared as one object.
    expect(restored.state.combat).toEqual(midCombat.state.combat);
    expect(restored.state.adventure).toEqual(midCombat.state.adventure);

    // Gameplay stays refused until the host resumes, even straight over the wire.
    const rejectMark = resumed.mark();
    resumed.send(envelope("early-turn", restored.revision, { type: "end-turn", facing: "north" }));
    const refused = await resumed.waitFor(
      (message): message is ServerError => message.type === "error" && message.requestId === "early-turn",
      rejectMark,
    );
    expect(refused.code).toBe("FORBIDDEN");

    const active = await play(resumed, restored, "resume", { type: "resume-adventure" });
    expect(active.state.lifecycle).toBe("active");
    // Resume publishes the exact hash it restored: it is not a gameplay transition.
    expect(active.gameplayHash).toBe(savedHash);

    const played = await play(resumed, active, "first-turn", { type: "end-turn", facing: "east" });
    expect(played.gameplayHash).not.toBe(savedHash);
    const after = await api<{ readonly campaigns: readonly CampaignSummary[] }>(
      second.origin, secondCookie, "GET", "/api/campaigns");
    expect(after.body.campaigns[0]?.hasSave).toBe(true);
  }, 60_000);

  it("invalidates the previous live credential when a campaign is continued", async () => {
    const file = databasePath();
    await seedAccount(file);
    const server = await startServer(file);
    const cookie = await signIn(server.origin);
    const opened = await openCampaign(server.origin, cookie);
    const original = await SocketClient.connect(server.origin, opened.credential);
    sockets.push(original);
    await playToCombat(original);

    const continued = await api<SessionCredentialResponse>(
      server.origin, cookie, "POST", `/api/campaigns/${opened.campaignId}/continue`, {});
    expect(continued.status).toBe(200);

    // The retired session closes with its own code so the client stops reconnecting.
    expect(await original.waitForClose()).toBe(4005);
    const stale = await SocketClient.connect(server.origin, opened.credential);
    sockets.push(stale);
    const error = await stale.waitFor((message): message is ServerError => message.type === "error");
    expect(error.code).toBe("SESSION_NOT_FOUND");
  }, 60_000);

  it("lets a fresh guest rejoin a resumed campaign, reclaim a saved character, and play on", async () => {
    const file = databasePath();
    await seedAccount(file);
    const server = await startServer(file);
    const cookie = await signIn(server.origin);
    const opened = await openCampaign(server.origin, cookie);
    const hostClient = await SocketClient.connect(server.origin, opened.credential);
    sockets.push(hostClient);
    const midCombat = await playToCombat(hostClient);
    await hostClient.close();
    sockets.pop();

    const continued = await api<SessionCredentialResponse>(
      server.origin, cookie, "POST", `/api/campaigns/${opened.campaignId}/continue`, {});
    const resumedHost = await SocketClient.connect(server.origin, continued.body);
    sockets.push(resumedHost);
    const restored = await resumedHost.snapshot();

    const joined = await fetch(new URL(`/api/sessions/${continued.body.sessionId}/join`, server.origin), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: "Returning Guest" }),
    });
    expect(joined.status).toBe(200);
    const guestCredential = await joined.json() as SessionCredentialResponse;
    const guest = await SocketClient.connect(server.origin, guestCredential);
    sockets.push(guest);
    const guestSnapshot = await guest.snapshot();
    expect(guestSnapshot.state.lifecycle).toBe("resume-lobby");

    const claimed = await play(guest, guestSnapshot, "claim", { type: "select-character", memberId: "party.hero-2" });
    // A reclaim is control, not gameplay: the restored hash is untouched.
    expect(claimed.gameplayHash).toBe(restored.gameplayHash);
    expect(claimed.control.effectiveControllerByMemberId["party.hero-2"]).toBe(guestCredential.playerId);
    expect(claimed.control.effectiveControllerByMemberId["party.hero-1"]).toBe(continued.body.playerId);

    const active = await play(resumedHost, claimed, "resume", { type: "resume-adventure" });
    expect(active.state.lifecycle).toBe("active");
    expect(active.gameplayHash).toBe(midCombat.gameplayHash);
  }, 60_000);

  it("recovers the previous save when the server dies before the durable write", async () => {
    const file = databasePath();
    await seedAccount(file);
    const child = await startChild(file);
    const cookie = await signIn(child.origin);
    const opened = await openCampaign(child.origin, cookie);
    const client = await SocketClient.connect(child.origin, opened.credential);
    sockets.push(client);
    const midCombat = await playToCombat(client);
    // Armed only now, so the setup writes cannot be mistaken for the transition under test.
    await child.arm({ when: "before", target: "combat-command" });

    // The process dies before this end-turn's write reaches SQLite.
    client.send(envelope("doomed-turn", midCombat.revision, { type: "end-turn", facing: "north" }));
    expect(await child.exited).toEqual({ code: null, signal: "SIGKILL" });
    expect(child.marker()).toMatchObject({ when: "before", target: "combat-command", matched: 1 });
    children.splice(0);
    sockets.splice(0);

    const recovered = await startServer(file);
    const recoveredCookie = await signIn(recovered.origin);
    const continued = await api<SessionCredentialResponse>(
      recovered.origin, recoveredCookie, "POST", `/api/campaigns/${opened.campaignId}/continue`, {});
    expect(continued.status).toBe(200);
    const resumed = await SocketClient.connect(recovered.origin, continued.body);
    sockets.push(resumed);
    const restored = await resumed.snapshot();

    // The uncommitted turn is gone, and the last committed one is intact and unduplicated.
    expect(restored.gameplayHash).toBe(midCombat.gameplayHash);
    expect(restored.state.adventure).toEqual(midCombat.state.adventure);
    expect(restored.state.combat).toEqual(midCombat.state.combat);
  }, 90_000);

  it("recovers the committed save when the server dies after the write but before publishing it", async () => {
    const file = databasePath();
    await seedAccount(file);
    const child = await startChild(file);
    const cookie = await signIn(child.origin);
    const opened = await openCampaign(child.origin, cookie);
    const client = await SocketClient.connect(child.origin, opened.credential);
    sockets.push(client);
    const midCombat = await playToCombat(client);
    await child.arm({ when: "after", target: "combat-command" });
    const intent: SessionIntent = { type: "end-turn", facing: "north" };
    // The client never sees an ACK for this, but the database is about to hold it.
    const expected = nextState(midCombat.state, intent);

    client.send(envelope("unacked-turn", midCombat.revision, intent));
    expect(await child.exited).toEqual({ code: null, signal: "SIGKILL" });
    expect(child.marker()).toMatchObject({ when: "after", target: "combat-command", matched: 1 });
    children.splice(0);
    sockets.splice(0);

    const recovered = await startServer(file);
    const recoveredCookie = await signIn(recovered.origin);
    const continued = await api<SessionCredentialResponse>(
      recovered.origin, recoveredCookie, "POST", `/api/campaigns/${opened.campaignId}/continue`, {});
    const resumed = await SocketClient.connect(recovered.origin, continued.body);
    sockets.push(resumed);
    const restored = await resumed.snapshot();

    expect(restored.gameplayHash).toBe(hashSessionGameplayState(expected));
    expect(restored.gameplayHash).not.toBe(midCombat.gameplayHash);
    expect(restored.state.adventure).toEqual(expected.adventure);
    expect(restored.state.combat).toEqual(expected.combat);
    // The recovered encounter progress is applied exactly once.
    expect(restored.state.adventure?.completedEncounterIds).toEqual(midCombat.state.adventure?.completedEncounterIds);
    expect(restored.state.adventure?.collection).toEqual(midCombat.state.adventure?.collection);
  }, 90_000);
});
