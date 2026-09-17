import { expect, it } from "vitest";
import { startCardGuildServer } from "../../../src/server/server";
import { createOpaqueId, createReconnectCredential, digestToken } from "../../../src/server/credentials";
import type { SessionCredentialResponse } from "../../../src/server/session-store";
import { context, SECOND } from "../../support/session";
import { diskStore } from "../../support/storage";
import { api, register, TEST_ORIGIN, Wire } from "../../support/network";

async function server() {
  const disk = await diskStore();
  try {
    const running = await startCardGuildServer({ context, persistence: disk.persistence, allowedOrigins: new Set([TEST_ORIGIN]),
      sources: { sessionId: () => createOpaqueId("session"), playerId: () => createOpaqueId("player"), reconnectCredential: createReconnectCredential, adventureSeed: () => 60 },
    });
    return { ...running, disk, async dispose() { try { await running.close(); } finally { await disk.close(true); } } };
  } catch (error) { await disk.close(); throw error; }
}

it("B-ACCOUNT HTTP ownership and logout/expiry prevent another account from reading or continuing a campaign", async () => {
  const running = await server();
  try {
    const host = await register(running.origin, "host-account");
    const stranger = await register(running.origin, "stranger-account");
    const created = await api(running.origin, "/api/campaigns", { name: "Private adventure" }, host.cookie);
    expect(created.status).toBe(201);
    const { campaign } = await created.json() as { campaign: { campaignId: string } };
    const foreign = await api(running.origin, "/api/campaigns", undefined, stranger.cookie);
    expect(await foreign.json()).toEqual({ campaigns: [] });
    expect((await api(running.origin, `/api/campaigns/${campaign.campaignId}/continue`, {}, stranger.cookie)).status).toBe(404);
    expect((await api(running.origin, "/api/auth/logout", {}, host.cookie)).status).toBe(204);
    expect((await api(running.origin, "/api/campaigns", undefined, host.cookie)).status).toBe(401);
    // An already-expired credential exercises HTTP expiry without waiting for wall time.
    running.disk.persistence.authSessions.create({ tokenDigest: digestToken("expired-contract-token"), accountId: host.account.accountId, createdAt: 0, expiresAt: 1 });
    const expiredCookie = `${host.cookie.split("=")[0]}=expired-contract-token`;
    expect((await api(running.origin, `/api/campaigns/${campaign.campaignId}/continue`, {}, expiredCookie)).status).toBe(401);
  } finally { await running.dispose(); }
});

it("B-COOP actual guest disconnect/reconnect transfers control without changing gameplay; B-WIRE delivers authenticated intents", async () => {
  const running = await server();
  const wires: Wire[] = [];
  try {
    const account = await register(running.origin, "coop-owner");
    const response = await api(running.origin, "/api/campaigns", { name: "Co-op" }, account.cookie);
    const created = await response.json() as SessionCredentialResponse;
    const host = await Wire.open(running.origin, created); wires.push(host);
    await host.snapshot();
    await host.intent({ type: "set-party-composition", actorDefinitionIds: ["hero.aerin", "hero.lyra"] });
    const joined = await api(running.origin, `/api/sessions/${created.sessionId}/join`, { displayName: "Guest" });
    const credential = await joined.json() as SessionCredentialResponse;
    const guest = await Wire.open(running.origin, credential); wires.push(guest);
    await guest.snapshot();
    const claimed = await guest.intent({ type: "select-character", memberId: SECOND });
    const controlled = await host.snapshot(m => m.control.effectiveControllerByMemberId[SECOND] === credential.playerId);
    expect(controlled.revision).toBe(claimed.revision);
    await guest.close();
    const fallback = await host.snapshot(m => m.controlRevision > controlled.controlRevision && m.control.effectiveControllerByMemberId[SECOND] === created.playerId);
    expect(fallback.gameplayHash).toBe(controlled.gameplayHash);
    expect(fallback.revision).toBe(controlled.revision);
    const returned = await Wire.open(running.origin, credential); wires.push(returned);
    await returned.snapshot();
    const restored = await host.snapshot(m => m.controlRevision > fallback.controlRevision && m.control.effectiveControllerByMemberId[SECOND] === credential.playerId);
    expect(restored.gameplayHash).toBe(fallback.gameplayHash);
    expect(restored.revision).toBe(fallback.revision);
    const denied = await Wire.open(running.origin, { ...credential, reconnectToken: "wrong-token" }); wires.push(denied);
    expect(await denied.wait(m => m.type === "error")).toMatchObject({ code: "UNAUTHENTICATED" });
  } finally {
    await Promise.all(wires.map(wire => wire.close()));
    await running.dispose();
  }
});
