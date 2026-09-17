import { expect, it } from "vitest";
import { createCampaignService } from "../../../src/server/campaign-service";
import { SessionStore } from "../../../src/server/session-store";
import type { SessionDurability } from "../../../src/server/campaign-durability";
import { context, HERO } from "../../support/session";
import { deferred, envelope, mailbox } from "../../support/host";
import { diskStore, owner } from "../../support/storage";

it("B-RESUME Continue racing an in-flight commit restores the latest approved checkpoint and retires the old writer", async () => {
  const disk = await diskStore();
  const entered = deferred(); const release = deferred();
  let delayed = false;
  class DelayedStore extends SessionStore {
    override create(displayName?: string, durability?: SessionDurability) {
      return super.create(displayName, { async commitGameplayTransition(previous, candidate) {
        if (delayed) { entered.resolve(); await release.promise; }
        await durability!.commitGameplayTransition(previous, candidate);
      } });
    }
  }
  const store = new DelayedStore(context);
  try {
    const account = owner(disk.persistence);
    const campaigns = createCampaignService(disk.persistence, store);
    const created = campaigns.create(account.accountId, "Continue race");
    const host = store.get(created.credential.sessionId)!;
    const output = mailbox();
    expect(await host.attach(created.credential.playerId, created.credential.reconnectToken, host.state.contentIdentity, output.connection)).toEqual({ ok: true });
    const send = async (intent: Parameters<typeof envelope>[1]) => host.handleIntent(created.credential.playerId, output.connection.id, envelope(host.state, intent));
    await send({ type: "set-party-composition", actorDefinitionIds: ["hero.aerin"] });
    await send({ type: "begin-adventure" });
    delayed = true;
    const writing = send({ type: "set-loadout", memberId: HERO, loadout: { equipment: {}, preparedCards: [] } });
    await entered.promise;
    const continuing = campaigns.continue(account.accountId, created.campaign.campaignId);
    release.resolve();
    await writing;
    const result = await continuing;
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.code);
    expect(host.retired).toBe(true);
    expect(output.closed).toContainEqual(expect.objectContaining({ code: 4005 }));
    const fresh = store.get(result.credential.sessionId)!;
    expect(fresh.state.lifecycle).toBe("resume-lobby");
    expect(fresh.state.adventure!.party.members[HERO]!.loadout).toEqual({ equipment: {}, preparedCards: [] });
    expect(result.credential.sessionId).not.toBe(created.credential.sessionId);
  } finally { release.resolve(); await store.drain(); await disk.close(); }
});

it("B-RESUME corrupt save preflight preserves both the stored bytes and the existing playable session", async () => {
  const disk = await diskStore(); const store = new SessionStore(context);
  try {
    const account = owner(disk.persistence);
    const campaigns = createCampaignService(disk.persistence, store);
    const created = campaigns.create(account.accountId, "Keep original");
    const host = store.get(created.credential.sessionId)!;
    const output = mailbox();
    await host.attach(created.credential.playerId, created.credential.reconnectToken, host.state.contentIdentity, output.connection);
    for (const intent of [{ type: "set-party-composition", actorDefinitionIds: ["hero.aerin"] }, { type: "begin-adventure" }] as const) {
      await host.handleIntent(created.credential.playerId, output.connection.id, envelope(host.state, intent));
    }
    const loaded = disk.persistence.campaigns.loadOwnedSave(created.campaign.campaignId, account.accountId);
    if (loaded.status !== "loaded") throw new Error("Expected save");
    disk.persistence.campaigns.commitSave({ ...loaded.record, expectedCampaignRevision: loaded.record.campaignRevision, snapshotJson: "{damaged" });
    const damaged = disk.persistence.campaigns.loadOwnedSave(created.campaign.campaignId, account.accountId);
    expect(await campaigns.continue(account.accountId, created.campaign.campaignId)).toMatchObject({ ok: false, code: "SAVE_CORRUPT" });
    expect(host.retired).toBe(false);
    expect(store.get(created.credential.sessionId)).toBe(host);
    expect(output.closed).toEqual([]);
    expect(host.state.adventure?.phase).toBe("between-encounters");
    expect(disk.persistence.campaigns.loadOwnedSave(created.campaign.campaignId, account.accountId)).toEqual(damaged);
  } finally { await store.drain(); await disk.close(); }
});
