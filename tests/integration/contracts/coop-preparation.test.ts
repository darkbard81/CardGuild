import { expect, it } from "vitest";
import { startCardGuildServer } from "../../../src/server/server";
import { createCampaignSave } from "../../../src/server/campaign-save";
import { SessionHost } from "../../../src/server/session-host";
import { createReconnectCredential } from "../../../src/server/credentials";
import type { SessionCredentialResponse } from "../../../src/server/session-store";
import { recruitmentAct, recruitmentContext as context, recruitmentReward, recruitIntent } from "../../support/recruitment";
import { context as legacyContext, act, lobby, SECOND } from "../../support/session";
import { api, TEST_ORIGIN, Wire } from "../../support/network";
import { deferred, envelope, mailbox } from "../../support/host";
import type { SessionCoreState } from "../../../src/session";

const recruited = () => recruitmentAct(recruitmentReward(), recruitIntent);
async function server(initial = recruited(), authority = context) {
  const running = await startCardGuildServer({ context: authority, allowedOrigins: new Set([TEST_ORIGIN]) });
  const credential = running.store.restore(createCampaignSave(initial));
  const wires: Wire[] = [];
  const open = async (value: SessionCredentialResponse) => { const wire = await Wire.open(running.origin, value); wires.push(wire); return wire; };
  const host = await open(credential); await host.snapshot(); await host.intent({ type: "resume-adventure" });
  return { ...running, credential, host, open, authority: running.store.get(credential.sessionId)!,
    join: () => api(running.origin, `/api/sessions/${credential.sessionId}/join`, { displayName: "Guest" }),
    async dispose() { await Promise.all(wires.map(wire => wire.close())); await running.close(); } };
}

it("B-COOP seed=65 one HTTP reservation wins; late attach after departure is revoked", async () => {
  const running = await server();
  try {
    expect((await running.join()).ok).toBe(false);
    await running.host.intent({ type: "set-coop-allowed", memberIds: [SECOND], revokeGuests: false });
    const responses = await Promise.all([running.join(), running.join()]);
    expect(responses.filter(response => response.ok)).toHaveLength(1);
    const guest = await responses.find(response => response.ok)!.json() as SessionCredentialResponse;
    await running.host.snapshot(snapshot => snapshot.state.seats.length === 2);
    const combat = await running.host.intent({ type: "start-encounter" });
    expect(combat.state.seats).toHaveLength(1);
    const late = await running.open(guest);
    expect(await late.wait(message => message.type === "error")).toMatchObject({ code: "UNAUTHENTICATED" });
    expect((await running.join()).ok).toBe(false);
  } finally { await running.dispose(); }
});

it("B-COOP seed=60 two simultaneous claims have one winner and loser receives latest snapshot", async () => {
  const initial = act(act(lobby(), { type: "set-party-composition", actorDefinitionIds: ["hero.aerin", "hero.lyra", "hero.nera"] }), { type: "begin-adventure" });
  const running = await server(initial, legacyContext);
  try {
    await running.host.intent({ type: "set-coop-allowed", memberIds: [SECOND, "party.hero-3"], revokeGuests: false });
    const credentials = await Promise.all([running.join(), running.join()].map(async response => await (await response).json() as SessionCredentialResponse));
    const guests = await Promise.all(credentials.map(value => running.open(value)));
    await Promise.all(guests.map(guest => guest.snapshot()));
    const current = running.authority.state;
    for (const guest of guests) guest.socket.send(JSON.stringify(envelope(current, { type: "select-character", memberId: SECOND }, "race-claim")));
    const acks = await Promise.all(guests.map(guest => guest.wait(message => message.type === "ack" && message.requestId === "race-claim")));
    expect(acks.filter(ack => ack.type === "ack" && ack.accepted)).toHaveLength(1);
    const loserIndex = acks.findIndex(ack => ack.type === "ack" && !ack.accepted);
    const loser = guests[loserIndex]!;
    expect(await loser.wait(message => message.type === "error" && message.requestId === "race-claim")).toMatchObject({ code: "STALE_REVISION" });
    const latest = await loser.snapshot(snapshot => snapshot.cause?.kind === "resync" && snapshot.revision > current.revision);
    expect(latest.state.guestClaims.byMemberId[SECOND]).toBeDefined();
    await loser.intent({ type: "select-character", memberId: "party.hero-3" });
    expect(new Set(Object.values(running.authority.state.guestClaims.byMemberId)).size).toBe(2);
  } finally { await running.dispose(); }
});

it("B-COOP seed=65 combat reconnect restores a valid claim; explicit reclaim revokes old credentials", async () => {
  const running = await server();
  try {
    await running.host.intent({ type: "set-coop-allowed", memberIds: [SECOND], revokeGuests: false });
    const credential = await (await running.join()).json() as SessionCredentialResponse;
    const guest = await running.open(credential); await guest.snapshot();
    const claimed = await guest.intent({ type: "select-character", memberId: SECOND });
    await running.host.snapshot(snapshot => snapshot.revision === claimed.revision);
    const started = await running.host.intent({ type: "start-encounter" });
    await guest.close();
    const fallback = await running.host.snapshot(snapshot => snapshot.controlRevision > started.controlRevision && snapshot.control.effectiveControllerByMemberId[SECOND] === running.credential.playerId);
    const returned = await running.open(credential);
    const restored = await returned.snapshot();
    expect(restored.gameplayHash).toBe(fallback.gameplayHash);
    expect(restored.control.effectiveControllerByMemberId[SECOND]).toBe(credential.playerId);
  } finally { await running.dispose(); }
  const preparation = await server();
  try {
    await preparation.host.intent({ type: "set-coop-allowed", memberIds: [SECOND], revokeGuests: false });
    const credential = await (await preparation.join()).json() as SessionCredentialResponse;
    const guest = await preparation.open(credential); await guest.snapshot();
    const claimed = await guest.intent({ type: "select-character", memberId: SECOND });
    await preparation.host.snapshot(snapshot => snapshot.revision === claimed.revision);
    await preparation.host.intent({ type: "set-coop-allowed", memberIds: [], revokeGuests: true });
    expect(await guest.wait(message => message.type === "error")).toMatchObject({ code: "COOP_ENDED" });
    const returned = await preparation.open(credential);
    expect(await returned.wait(message => message.type === "error")).toMatchObject({ code: "UNAUTHENTICATED" });
  } finally { await preparation.dispose(); }
});

it("B-COOP seed=65 failed/delayed solo commit preserves guest access; retry revokes once after success", async () => {
  const initial = recruitmentAct(recruited(), { type: "set-coop-allowed", memberIds: [SECOND], revokeGuests: false });
  const entered = deferred(), release = deferred(); let fail = true; let candidate: SessionCoreState | undefined;
  const hostCredential = createReconnectCredential(), guestCredential = createReconnectCredential();
  const host = new SessionHost(initial, context, hostCredential.digest, { durability: { async commitGameplayTransition(_previous, next) {
    if (!next.combat) return;
    candidate = next; entered.resolve(); await release.promise;
    if (fail) throw new Error("Injected write failure");
  } } });
  const hostOut = mailbox(), guestOut = mailbox("guest");
  await host.attach("host", hostCredential.token, initial.contentIdentity, hostOut.connection);
  await host.addPlayer({ playerId: "guest", displayName: "Guest" }, guestCredential.digest);
  await host.attach("guest", guestCredential.token, initial.contentIdentity, guestOut.connection);
  await host.handleIntent("guest", guestOut.connection.id, envelope(host.state, { type: "select-character", memberId: SECOND }));
  const before = host.state; const request = envelope(before, { type: "proceed-solo" }, "solo-retry");
  const writing = host.handleIntent("host", hostOut.connection.id, request);
  await entered.promise;
  expect(candidate?.seats).toHaveLength(1); expect(host.state).toBe(before); expect(guestOut.closed).toEqual([]);
  release.resolve(); await writing;
  expect(host.state).toBe(before); expect(guestOut.closed).toEqual([]);
  expect(hostOut.messages).toContainEqual(expect.objectContaining({ type: "error", code: "PERSISTENCE_FAILED" }));
  fail = false; await host.handleIntent("host", hostOut.connection.id, request);
  expect(host.state.seats).toHaveLength(1); expect(guestOut.closed).toHaveLength(1);
  expect(await host.attach("guest", guestCredential.token, initial.contentIdentity, mailbox("late").connection)).toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
  const accepted = host.state;
  await host.handleIntent("host", hostOut.connection.id, request);
  expect(host.state).toBe(accepted); expect(guestOut.closed).toHaveLength(1);
});

it("B-COOP seed=65 queue orders attach/departure, allow/join, Loadout/departure and solo/reconnect", async () => {
  const initial = recruitmentAct(recruited(), { type: "set-coop-allowed", memberIds: [SECOND], revokeGuests: false });
  const credential = createReconnectCredential(), guestCredential = createReconnectCredential();
  const entered = deferred(), release = deferred(); let delay = false;
  const host = new SessionHost(initial, context, credential.digest, { durability: { async commitGameplayTransition() {
    if (delay) { entered.resolve(); await release.promise; }
  } } });
  const output = mailbox(), guest = mailbox("guest");
  await host.attach("host", credential.token, initial.contentIdentity, output.connection);
  // Revocation queued first makes a later HTTP admission observe the closed list.
  const revoke = host.handleIntent("host", output.connection.id, envelope(host.state, { type: "set-coop-allowed", memberIds: [], revokeGuests: false }));
  const join = host.addPlayer({ playerId: "guest", displayName: "Guest" }, guestCredential.digest);
  await revoke; expect((await join).accepted).toBe(false);
  await host.handleIntent("host", output.connection.id, envelope(host.state, { type: "set-coop-allowed", memberIds: [SECOND], revokeGuests: false }));
  await host.addPlayer({ playerId: "guest", displayName: "Guest" }, guestCredential.digest);
  const revision = host.state;
  const attaching = host.attach("guest", guestCredential.token, initial.contentIdentity, guest.connection);
  const departure = host.handleIntent("host", output.connection.id, envelope(revision, { type: "start-encounter" }, "depart-after-attach"));
  expect(await attaching).toEqual({ ok: true }); await departure;
  expect(host.state.combat).toBeNull();
  expect(output.messages).toContainEqual(expect.objectContaining({ type: "ack", requestId: "depart-after-attach", accepted: false }));
  await host.handleIntent("guest", guest.connection.id, envelope(host.state, { type: "select-character", memberId: SECOND }));
  delay = true;
  const before = host.state;
  const loadout = host.handleIntent("guest", guest.connection.id, envelope(before, { type: "set-loadout", memberId: SECOND, loadout: { equipment: {}, preparedCards: [] } }, "guest-kit"));
  await entered.promise;
  const staleDeparture = host.handleIntent("host", output.connection.id, envelope(before, { type: "start-encounter" }, "depart-during-kit"));
  release.resolve(); await loadout; await staleDeparture;
  expect(host.state.adventure!.party.members[SECOND]!.loadout.equipment).toEqual({});
  expect(host.state.combat).toBeNull();
  expect(output.messages).toContainEqual(expect.objectContaining({ type: "error", requestId: "depart-during-kit", code: "STALE_REVISION" }));
  delay = false;
  await host.detach("guest", guest.connection.id);
  const solo = host.handleIntent("host", output.connection.id, envelope(host.state, { type: "proceed-solo" }));
  const reconnect = host.attach("guest", guestCredential.token, initial.contentIdentity, mailbox("reconnect").connection);
  await solo; expect(await reconnect).toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
});
