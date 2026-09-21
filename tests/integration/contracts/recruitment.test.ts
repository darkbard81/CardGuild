import type { ServerSnapshot } from "../../../src/protocol";
import { expect, it } from "vitest";
import { SessionHost } from "../../../src/server/session-host";
import { createReconnectCredential } from "../../../src/server/credentials";
import { createCampaignDurability } from "../../../src/server/campaign-durability";
import { restoreCampaignSave } from "../../../src/server/campaign-save";
import { createResumedSessionCoreState } from "../../../src/session";
import { deferred, envelope, mailbox } from "../../support/host";
import { diskStore, owner } from "../../support/storage";
import { saveRecord, HERO, SECOND } from "../../support/session";
import { recruitmentContext as context, recruitmentReward, recruitIntent } from "../../support/recruitment";

it("B-RECRUIT seed=65 durable failure publishes no NPC/slot/starter/event; same-request retry atomically persists once and survives reopen", async () => {
  const disk = await diskStore();
  try {
    const account = owner(disk.persistence);
    const initial = recruitmentReward();
    const campaignId = "recruitment-65";
    disk.persistence.campaigns.create({ campaignId, ownerAccountId: account.accountId, name: "Recruitment", campaignRevision: 0, hasSave: false, createdAt: 1, updatedAt: 1 });
    const checkpoint = saveRecord(initial);
    expect(disk.persistence.campaigns.commitSave({ ...checkpoint, campaignId, ownerAccountId: account.accountId, expectedCampaignRevision: 0 }).committed).toBe(true);
    const load = () => {
      const result = disk.persistence.campaigns.loadOwnedSave(campaignId, account.accountId);
      if (result.status !== "loaded") throw new Error("Expected durable checkpoint");
      return result.record;
    };
    disk.reopen();
    expect(restoreCampaignSave(load(), context).projection.adventure).toEqual(initial.adventure);
    const entered = deferred(), release = deferred();
    const durable = createCampaignDurability({ campaigns: disk.persistence.campaigns, campaignId, ownerAccountId: account.accountId, campaignRevision: 1, now: () => 2 });
    let fail = true, commits = 0;
    const credential = createReconnectCredential();
    const host = new SessionHost(initial, context, credential.digest, { durability: {
      async commitGameplayTransition(previous, candidate) {
        entered.resolve(); await release.promise;
        if (fail) throw new Error("injected recruitment storage failure");
        await durable.commitGameplayTransition(previous, candidate); commits++;
      },
    } });
    const output = mailbox();
    await host.attach("host", credential.token, initial.contentIdentity, output.connection);
    const request = envelope(initial, recruitIntent, "recruit-once-65");
    const pending = host.handleIntent("host", output.connection.id, request);
    try {
      await entered.promise;
      expect(host.state).toEqual(initial);
      expect(output.messages.some(message => message.type === "ack" && message.accepted)).toBe(false);
      expect(output.messages.filter(message => message.type === "snapshot").every(message => message.state.partySlots.length === 1 && message.state.adventure?.collection.equipment.halberd === 1
        && !message.events.some(event => event.type === "COMPANION_RECRUITED"))).toBe(true);
      expect(load().campaignRevision).toBe(1);
    } finally { release.resolve(); await pending; }
    expect(host.state).toEqual(initial);
    expect(load().campaignRevision).toBe(1);
    expect(output.messages).toContainEqual(expect.objectContaining({ type: "error", code: "PERSISTENCE_FAILED", requestId: request.requestId }));
    fail = false;
    await host.handleIntent("host", output.connection.id, request);
    const saved = structuredClone(host.state);
    await host.handleIntent("host", output.connection.id, request);
    expect(host.state).toEqual(saved); expect(commits).toBe(1); expect(load().campaignRevision).toBe(2);
    const committed = output.messages.filter((message): message is ServerSnapshot => message.type === "snapshot" && message.state.partySlots.length === 2);
    expect(committed.length).toBeGreaterThan(0);
    expect(committed[0]!.control.effectiveControllerByMemberId[SECOND]).toBe("host");
    expect(committed[0]!.state.adventure).toMatchObject({ pendingReward: null, collection: { equipment: { halberd: 2 } } });
    expect(saved.adventure!.party.members[HERO]).toEqual(initial.adventure!.party.members[HERO]);
    disk.reopen();
    const projection = restoreCampaignSave(load(), context).projection;
    expect(projection.adventure).toEqual(saved.adventure); expect(projection.partySlots).toEqual(saved.partySlots);
    const freshState = createResumedSessionCoreState({ sessionId: "fresh", playerId: "host", displayName: "Host" }, projection, context);
    const freshCredential = createReconnectCredential();
    const fresh = new SessionHost(freshState, context, freshCredential.digest);
    const freshOutput = mailbox("reopened");
    await fresh.attach("host", freshCredential.token, freshState.contentIdentity, freshOutput.connection);
    await fresh.handleIntent("host", freshOutput.connection.id, envelope(fresh.state, { type: "resume-adventure" }));
    await fresh.handleIntent("host", freshOutput.connection.id, envelope(fresh.state, recruitIntent, "duplicate-after-reopen"));
    expect(fresh.state.adventure).toEqual(saved.adventure);
    expect(freshOutput.messages).toContainEqual(expect.objectContaining({ type: "ack", requestId: "duplicate-after-reopen", accepted: false }));
  } finally { await disk.close(); }
});
