import { expect, it } from "vitest";
import { startCardGuildServer } from "../../../src/server/server";
import { createOpaqueId, createReconnectCredential, digestToken } from "../../../src/server/credentials";
import type { SessionCredentialResponse } from "../../../src/server/session-store";
import { context, HERO, SECOND } from "../../support/session";
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

it("B-CREATION-NAME seed=60 a 40-codepoint character name survives HTTP campaign creation and saved summaries", async () => {
  const running = await server();
  let wire: Wire | undefined;
  try {
    const account = await register(running.origin, "unicode-creator");
    const name = "🌟".repeat(40);
    const title = `${name}의 모험`;
    const response = await api(running.origin, "/api/campaigns", { name: title, displayName: name }, account.cookie);
    expect(response.status).toBe(201);
    wire = await Wire.open(running.origin, await response.json() as SessionCredentialResponse);
    await wire.snapshot();
    const saved = await wire.intent({ type: "create-character", name, gender: "female", creationPresetId: "human.wizard" });
    expect(saved.state.adventure!.party.members[HERO]!.identity).toMatchObject({ name, gender: "female" });
    const summaries = await api(running.origin, "/api/campaigns", undefined, account.cookie);
    expect(await summaries.json()).toMatchObject({ campaigns: [{ name: title, saveStatus: "ready",
      progress: { party: [{ name, appearanceKey: "human.wizard.female" }] } }] });
    expect((await api(running.origin, "/api/campaigns", { name: "🌟".repeat(61) }, account.cookie)).status).toBe(400);
  } finally { await wire?.close(); await running.dispose(); }
});

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

it("B-ACCOUNT campaign deletion requires ownership, retires connected guests and removes saved progress", async () => {
  const running = await server();
  const wires: Wire[] = [];
  try {
    const account = await register(running.origin, "delete-owner");
    const stranger = await register(running.origin, "delete-stranger");
    const response = await api(running.origin, "/api/campaigns", { name: "Delete adventure" }, account.cookie);
    const created = await response.json() as SessionCredentialResponse & { campaign: { campaignId: string } };
    const id = created.campaign.campaignId;
    const remove = (cookie = "") => fetch(`${running.origin}/api/campaigns/${id}`, { method: "DELETE", headers: { cookie } });
    const host = await Wire.open(running.origin, created); wires.push(host);
    await host.snapshot();
    await host.intent({ type: "set-party-composition", actorDefinitionIds: ["hero.aerin", "hero.lyra"] });
    const joined = await api(running.origin, `/api/sessions/${created.sessionId}/join`, { displayName: "Guest" });
    const guest = await Wire.open(running.origin, await joined.json() as SessionCredentialResponse); wires.push(guest);
    await guest.snapshot();
    const claimed = await guest.intent({ type: "select-character", memberId: SECOND });
    await host.snapshot(message => message.revision >= claimed.revision);
    await host.intent({ type: "begin-adventure" });
    expect(running.disk.persistence.campaigns.loadOwnedSave(id, account.account.accountId).status).toBe("loaded");
    expect((await remove()).status).toBe(401);
    expect((await remove(stranger.cookie)).status).toBe(404);
    expect(running.disk.persistence.campaigns.findOwned(id, account.account.accountId)).toBeDefined();
    const hostClosed = new Promise<number>(resolve => host.socket.once("close", code => resolve(code)));
    const guestClosed = new Promise<number>(resolve => guest.socket.once("close", code => resolve(code)));
    expect((await remove(account.cookie)).status).toBe(200);
    expect(await hostClosed).toBe(4005);
    expect(await guestClosed).toBe(4005);
    expect(running.disk.persistence.campaigns.loadOwnedSave(id, account.account.accountId).status).toBe("not-found");
    expect(await (await api(running.origin, "/api/campaigns", undefined, account.cookie)).json()).toEqual({ campaigns: [] });
    expect((await api(running.origin, `/api/campaigns/${id}/continue`, {}, account.cookie)).status).toBe(404);
    expect((await api(running.origin, `/api/sessions/${created.sessionId}/join`, {})).status).toBe(404);
    expect((await remove(account.cookie)).status).toBe(404);
  } finally {
    await Promise.all(wires.map(wire => wire.close()));
    await running.dispose();
  }
});
