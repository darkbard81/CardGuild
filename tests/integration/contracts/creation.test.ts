import { expect, it } from "vitest";
import { SessionHost } from "../../../src/server/session-host";
import { SessionStore } from "../../../src/server/session-store";
import { createCampaignService } from "../../../src/server/campaign-service";
import { createReconnectCredential } from "../../../src/server/credentials";
import { creationContext as context, creationIntent, creationLobby } from "../../support/creation";
import { deferred, envelope, mailbox } from "../../support/host";
import { diskStore, owner } from "../../support/storage";
import { HERO } from "../../support/session";

it("B-CREATION seed=63 commit delay/failure hides the future character; same-request retries award one starter", async () => {
  const entered = deferred(), release = deferred();
  let fail = true;
  const credential = createReconnectCredential();
  const state = creationLobby();
  const host = new SessionHost(state, context, credential.digest, { durability: {
    async commitGameplayTransition() { entered.resolve(); await release.promise; if (fail) throw new Error("injected storage failure"); },
  } });
  const output = mailbox();
  await host.attach("host", credential.token, state.contentIdentity, output.connection);
  const request = envelope(state, creationIntent, "create-once-63");
  const pending = host.handleIntent("host", output.connection.id, request);
  try {
    await entered.promise;
    expect(host.state.adventure).toBeNull();
    expect(output.messages.filter(m => m.type === "snapshot").every(m => m.state.adventure === null)).toBe(true);
    expect(output.messages.some(m => m.type === "ack" && m.accepted)).toBe(false);
  } finally { release.resolve(); await pending; }
  expect(host.state.adventure).toBeNull();
  expect(output.messages).toContainEqual(expect.objectContaining({ type: "error", code: "PERSISTENCE_FAILED", requestId: request.requestId }));
  fail = false;
  await host.handleIntent("host", output.connection.id, request);
  const saved = structuredClone(host.state);
  await host.handleIntent("host", output.connection.id, request);
  expect(host.state).toEqual(saved);
  expect(Object.keys(host.state.adventure!.party.members)).toEqual([HERO]);
  expect(host.state.adventure!.party.members[HERO]!.identity).toMatchObject({ name: "하늘", gender: "female" });
  expect(host.state.adventure!.collection.equipment["halberd"]).toBe(1);
  expect(output.messages).toContainEqual(expect.objectContaining({ type: "ack", requestId: request.requestId, accepted: true }));
  await host.handleIntent("host", output.connection.id, envelope(host.state, creationIntent, "second-creation"));
  expect(host.state).toEqual(saved);
});

it("B-CREATION seed=63 file-backed creation survives close/reopen and Continue with the same hero and next legal action", async () => {
  const disk = await diskStore();
  const store = new SessionStore(context);
  let nextStore: SessionStore | undefined;
  try {
    const account = owner(disk.persistence);
    const campaigns = createCampaignService(disk.persistence, store);
    const created = campaigns.create(account.accountId, "Created campaign", "Account display name");
    const host = store.get(created.credential.sessionId)!;
    const output = mailbox();
    await host.attach(created.credential.playerId, created.credential.reconnectToken, host.state.contentIdentity, output.connection);
    expect(campaigns.listSummaries(account.accountId)[0]).toMatchObject({ hasSave: false, saveStatus: "empty", progress: null });
    const request = envelope(host.state, creationIntent, "file-create-63");
    await host.handleIntent(created.credential.playerId, output.connection.id, request);
    const saved = structuredClone(host.state.adventure);
    expect(saved?.phase).toBe("between-encounters");
    expect(campaigns.listSummaries(account.accountId)[0]).toMatchObject({ hasSave: true, saveStatus: "ready",
      progress: { party: [{ memberId: HERO, name: "하늘", appearanceKey: "hero.nera", level: 1 }] } });
    await store.drain();
    disk.reopen();
    nextStore = new SessionStore(context);
    const reopened = createCampaignService(disk.persistence, nextStore);
    expect((await reopened.continue("another-account", created.campaign.campaignId)).ok).toBe(false);
    const continued = await reopened.continue(account.accountId, created.campaign.campaignId, "Different account label");
    expect(continued.ok).toBe(true);
    if (!continued.ok) throw new Error(continued.code);
    const next = nextStore.get(continued.credential.sessionId)!;
    const freshOutput = mailbox("fresh-connection");
    expect(next.state.sessionId).not.toBe(host.state.sessionId);
    expect(next.state.adventure).toEqual(saved);
    expect(next.state.guestClaims.byMemberId).toEqual({});
    await next.attach(continued.credential.playerId, continued.credential.reconnectToken, next.state.contentIdentity, freshOutput.connection);
    for (const intent of [{ type: "resume-adventure" }, { type: "start-encounter" }] as const) {
      const command = envelope(next.state, intent);
      await next.handleIntent(continued.credential.playerId, freshOutput.connection.id, command);
      expect(freshOutput.messages).toContainEqual(expect.objectContaining({ type: "ack", requestId: command.requestId, accepted: true }));
    }
    expect(next.state.combat!.actors[HERO]).toMatchObject({ name: "하늘", appearanceKey: "hero.nera", definitionId: "hero.aerin" });
    expect(next.state.adventure!.party.members[HERO]!.identity).toEqual(saved!.party.members[HERO]!.identity);
  } finally { await store.drain(); await nextStore?.drain(); await disk.close(); }
});
