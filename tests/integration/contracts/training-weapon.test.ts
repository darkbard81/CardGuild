import { expect, it } from "vitest";
import { createCampaignDurability } from "../../../src/server/campaign-durability";
import { restoreCampaignSave } from "../../../src/server/campaign-save";
import { createResumedSessionCoreState } from "../../../src/session";
import { diskStore, owner } from "../../support/storage";
import { HERO } from "../../support/session";
import { recruitedParty, tutorialAct as act, tutorialContext as context } from "../../support/tutorial";

it("B-FLANK SQLite reopen and Resume preserve the loaned dagger while the saved Ranger still owns and equips the bow", async () => {
  const disk = await diskStore();
  try {
    const account = owner(disk.persistence);
    const campaignId = "training-dagger";
    disk.persistence.campaigns.create({ campaignId, ownerAccountId: account.accountId, name: "Training", campaignRevision: 0, hasSave: false, createdAt: 1, updatedAt: 1 });
    const writer = createCampaignDurability({ campaigns: disk.persistence.campaigns, campaignId, ownerAccountId: account.accountId, campaignRevision: 0, now: () => 2 });
    const ready = recruitedParty(69, "human.ranger");
    const started = act(ready, { type: "start-encounter" });
    await writer.commitGameplayTransition(ready, started);
    const loaded = disk.reopen().campaigns.loadOwnedSave(campaignId, account.accountId);
    if (loaded.status !== "loaded") throw new Error("Missing committed training save");
    const restored = restoreCampaignSave(loaded.record, context).projection;
    const resumed = act(createResumedSessionCoreState({ sessionId: "fresh-training", playerId: "host", displayName: "Host" }, restored, context), { type: "resume-adventure" });
    expect(resumed.combat).toEqual(started.combat);
    expect(resumed.combat!.actors[HERO]!.equipmentIds).toContain("training-dagger");
    expect(resumed.adventure!.party.members[HERO]!.loadout.equipment.weapon).toBe("composite-shortbow");
    expect(resumed.adventure!.collection).toEqual(ready.adventure!.collection);
  } finally { await disk.close(); }
});
