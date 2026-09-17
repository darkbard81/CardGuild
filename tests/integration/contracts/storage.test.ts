import { expect, it } from "vitest";
import { createCampaignDurability } from "../../../src/server/campaign-durability";
import { restoreCampaignSave } from "../../../src/server/campaign-save";
import { act, adventure, context, HERO } from "../../support/session";
import { diskStore, owner } from "../../support/storage";

it("B-STORAGE file SQLite retains the winning checkpoint after reopen and refuses a competing writer", async () => {
  const disk = await diskStore();
  try {
    const account = owner(disk.persistence);
    const campaignId = "campaign-contract";
    disk.persistence.campaigns.create({ campaignId, ownerAccountId: account.accountId, name: "Durable campaign", campaignRevision: 0, hasSave: false, createdAt: 1, updatedAt: 1 });
    const options = { campaigns: disk.persistence.campaigns, campaignId, ownerAccountId: account.accountId, campaignRevision: 0, now: () => 2 };
    const writer = createCampaignDurability(options);
    const staleWriter = createCampaignDurability(options);
    const state = adventure();
    const changed = act(state, { type: "set-loadout", memberId: HERO, loadout: { equipment: {}, preparedCards: [] } });
    await writer.commitGameplayTransition(state, changed);
    const winning = disk.persistence.campaigns.loadOwnedSave(campaignId, account.accountId);
    await expect(staleWriter.commitGameplayTransition(state, act(state, { type: "start-encounter" }))).rejects.toMatchObject({ reason: "revision-conflict" });
    const loaded = disk.reopen().campaigns.loadOwnedSave(campaignId, account.accountId);
    expect(loaded).toEqual(winning);
    if (loaded.status !== "loaded") throw new Error("Missing committed disk checkpoint");
    expect(restoreCampaignSave(loaded.record, context).projection.adventure.party.members[HERO]!.loadout).toEqual({ equipment: {}, preparedCards: [] });
    expect(disk.persistence.campaigns.loadOwnedSave(campaignId, "another-owner")).toEqual({ status: "not-found" });
  } finally { await disk.close(); }
});
