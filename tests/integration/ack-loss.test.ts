import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { PRODUCTION_CONTENT } from "../../src/content";
import type { ServerAck, ServerError, ServerSnapshot } from "../../src/protocol";
import { createAuthService } from "../../src/server/auth-service";
import { digestReconnectToken } from "../../src/server/credentials";
import { createSqlitePersistence, type CampaignSaveRecord } from "../../src/server/persistence";
import { startCardGuildServer, type RunningCardGuildServer } from "../../src/server/server";
import type { SessionCredentialResponse } from "../../src/server/session-store";
import { settle } from "../support/campaign/campaign-drive";
import { SocketClient, TEST_ORIGIN, envelope, play } from "../support/network/socket-client";

const ACCOUNT = { username: "ack-host", password: "ack host password" };
const PARTY = ["hero.aerin", "hero.lyra", "hero.brom"] as const;
const CONTEXT = { pack: PRODUCTION_CONTENT.pack, adventureId: PRODUCTION_CONTENT.adventureId };

/**
 * A lost ACK is not a lost transition.
 *
 * The process stays up here; only the answer goes missing. A client that never learns
 * whether its request landed can only do one thing — send the identical request again —
 * and the request journal is what has to make that safe.
 */
describe("a live session that loses an ACK", () => {
  const directories: string[] = [];
  const servers: RunningCardGuildServer[] = [];
  const sockets: SocketClient[] = [];

  afterEach(async () => {
    await Promise.all(sockets.splice(0).map((socket) => socket.close()));
    for (const server of servers.splice(0)) await server.close().catch(() => undefined);
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
  });

  function databasePath(): string {
    const directory = mkdtempSync(path.join(tmpdir(), "cardguild-m9-5-ack-"));
    directories.push(directory);
    return path.join(directory, "campaigns.sqlite");
  }

  async function start(file: string): Promise<RunningCardGuildServer> {
    const persistence = createSqlitePersistence(file);
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
      body: JSON.stringify({ name: "Ack Trouble", displayName: "Host" }),
    });
    expect(response.status).toBe(201);
    const body = await response.json() as SessionCredentialResponse & { readonly campaign: { readonly campaignId: string } };
    return { campaignId: body.campaign.campaignId, credential: body };
  }

  function storedRecord(file: string, campaignId: string): CampaignSaveRecord {
    const persistence = createSqlitePersistence(file);
    try {
      const accountId = persistence.accounts.findByUsername(ACCOUNT.username)?.accountId ?? "";
      const lookup = persistence.campaigns.loadOwnedSave(campaignId, accountId);
      if (lookup.status !== "loaded") throw new Error(`Stored save is ${lookup.status}.`);
      return lookup.record;
    } finally {
      persistence.close();
    }
  }

  async function playToCombat(client: SocketClient): Promise<ServerSnapshot> {
    let snapshot = await client.snapshot();
    snapshot = await play(client, snapshot, "party", { type: "set-party-composition", actorDefinitionIds: [...PARTY] });
    snapshot = await play(client, snapshot, "begin", { type: "begin-adventure" });
    return await play(client, snapshot, "encounter", { type: "start-encounter" });
  }

  it("answers an identical retry from its journal and writes nothing a second time", async () => {
    const file = databasePath();
    await seedAccount(file);
    const server = await start(file);
    const cookie = await signIn(server.origin);
    const opened = await openCampaign(server.origin, cookie);
    const first = await SocketClient.connect(server.origin, opened.credential);
    sockets.push(first);
    const midCombat = await playToCombat(first);

    // The request goes out and the connection dies before its answer can be read. The
    // server has no idea the client is gone; it commits and replies into a dead socket.
    const lost = envelope("lost-ack", midCombat.revision, { type: "end-turn", facing: "north" });
    first.send(lost);
    first.socket.terminate();
    sockets.splice(sockets.indexOf(first), 1);

    const host = server.store.get(opened.credential.sessionId);
    if (!host) throw new Error("The live session vanished.");
    await expect.poll(() => host.state.revision, { timeout: 10_000 }).toBeGreaterThan(midCombat.revision);
    const committed = storedRecord(file, opened.campaignId);
    expect(committed.snapshotHash).not.toBe(midCombat.gameplayHash);

    // The client cannot tell whether that landed, so it reconnects and asks again — the
    // same requestId, the same expectedRevision, the same payload.
    const second = await SocketClient.connect(server.origin, opened.credential);
    sockets.push(second);
    await second.snapshot();
    const mark = second.mark();
    second.send(lost);
    const replay = await second.ack("lost-ack", mark);
    expect(replay.accepted).toBe(true);
    // The journal replays the answer this request actually got, which is its own commit —
    // not wherever the session has since travelled on the server's own enemy turns.
    expect(replay.committedRevision).toBe(midCombat.revision + 1);
    // A resync follows it, so the client is left holding current state rather than that one.
    const resync = await second.waitFor(
      (message): message is ServerSnapshot => message.type === "snapshot", mark);
    expect(resync.cause).toMatchObject({ kind: "resync", requestId: "lost-ack" });
    expect(resync.revision).toBe(host.state.revision);

    // Nothing moved: not the campaign, not the save, not the progress.
    const after = storedRecord(file, opened.campaignId);
    expect(after.campaignRevision).toBe(committed.campaignRevision);
    expect(after.snapshotHash).toBe(committed.snapshotHash);
    expect(resync.state.adventure?.completedEncounterIds)
      .toEqual(midCombat.state.adventure?.completedEncounterIds);
    expect(resync.state.adventure?.collection).toEqual(midCombat.state.adventure?.collection);
    expect(Object.values(resync.state.adventure?.party.members ?? {}).map((member) => member.progression))
      .toEqual(Object.values(midCombat.state.adventure?.party.members ?? {}).map((member) => member.progression));

    // The same id with a different payload is a client bug, not a retry.
    const reuseMark = second.mark();
    second.send(envelope("lost-ack", resync.revision, { type: "end-turn", facing: "south" }));
    const reuse = await second.waitFor(
      (message): message is ServerError => message.type === "error" && message.requestId === "lost-ack", reuseMark);
    expect(reuse.code).toBe("REQUEST_ID_REUSE");
    expect(storedRecord(file, opened.campaignId).campaignRevision).toBe(committed.campaignRevision);

    // And the client is unblocked: the next request is ordinary work.
    const played = await play(second, resync, "next-turn", { type: "end-turn", facing: "east" });
    expect(played.revision).toBeGreaterThan(resync.revision);
  }, 90_000);

  it("gives a restarted server no memory of past requests, and refuses the old credential", async () => {
    const file = databasePath();
    await seedAccount(file);
    const first = await start(file);
    const cookie = await signIn(first.origin);
    const opened = await openCampaign(first.origin, cookie);
    const client = await SocketClient.connect(first.origin, opened.credential);
    sockets.push(client);
    const midCombat = await playToCombat(client);
    await play(client, midCombat, "before-restart", { type: "end-turn", facing: "north" });
    // The server keeps committing its own enemy turns after the ACK, so the last thing the
    // client sees — not the ACK's snapshot — is what the database ends up holding.
    const played = await settle(client);
    if (!played) throw new Error("The server never came back to a player boundary.");
    await client.close();
    sockets.splice(sockets.indexOf(client), 1);
    await first.close();
    servers.splice(servers.indexOf(first), 1);

    const second = await start(file);
    const secondCookie = await signIn(second.origin);
    // The live session did not survive the process, so the old credential is not a way in.
    const stale = await SocketClient.connect(second.origin, opened.credential);
    sockets.push(stale);
    const refused = await stale.waitFor((message): message is ServerError => message.type === "error");
    expect(refused.code).toBe("SESSION_NOT_FOUND");

    const continued = await fetch(new URL(`/api/campaigns/${opened.campaignId}/continue`, second.origin), {
      method: "POST",
      headers: { cookie: secondCookie, "content-type": "application/json" },
      body: "{}",
    });
    expect(continued.status).toBe(200);
    const credential = await continued.json() as SessionCredentialResponse;
    const resumed = await SocketClient.connect(second.origin, credential);
    sockets.push(resumed);
    const restored = await resumed.snapshot();

    // A fresh session starts from the saved gameplay with no journal and no replay of past
    // requests: the same requestId is simply judged against the new revision.
    expect(restored.gameplayHash).toBe(played.gameplayHash);
    expect(restored.revision).toBe(0);
    const mark = resumed.mark();
    resumed.send(envelope("before-restart", played.revision, { type: "end-turn", facing: "north" }));
    const answer = await resumed.waitFor(
      (message): message is ServerAck => message.type === "ack" && message.requestId === "before-restart", mark);
    expect(answer.accepted).toBe(false);
    const error = await resumed.waitFor(
      (message): message is ServerError => message.type === "error" && message.requestId === "before-restart", mark);
    expect(error.code).toBe("STALE_REVISION");
    expect(storedRecord(file, opened.campaignId).snapshotHash).toBe(played.gameplayHash);
  }, 90_000);
});
