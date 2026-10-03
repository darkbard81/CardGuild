import { expect, it } from "vitest";
import { createCampaignDurability } from "../../../src/server/campaign-durability";
import { restoreCampaignSave } from "../../../src/server/campaign-save";
import { createResumedSessionCoreState } from "../../../src/session";
import { diskStore, owner } from "../../support/storage";
import { HERO } from "../../support/session";
import { chapterReady, chapterReward, claimChapterReward } from "../../support/chapter-one";
import { tutorialAct as act, tutorialContext as context } from "../../support/tutorial";

it("B-CHAPTER each reward checkpoint and completed deck survive SQLite close/reopen and Resume without duplicate grants", async () => {
  const disk = await diskStore();
  try {
    const account = owner(disk.persistence); const campaignId = "chapter-one";
    disk.persistence.campaigns.create({ campaignId, ownerAccountId: account.accountId, name: "Willowbrook", campaignRevision: 0, hasSave: false, createdAt: 1, updatedAt: 1 });
    let state = chapterReady(); let revision = 0;
    for (let index = 0; index < 4; index++) {
      const reward = chapterReward(state);
      const writer = createCampaignDurability({ campaigns: disk.persistence.campaigns, campaignId, ownerAccountId: account.accountId, campaignRevision: revision, now: () => index + 2 });
      await writer.commitGameplayTransition(state,reward); revision++;
      const saved = disk.reopen().campaigns.loadOwnedSave(campaignId,account.accountId);
      if (saved.status !== "loaded") throw new Error("Missing reward save");
      const restored = restoreCampaignSave(saved.record,context).projection;
      const resumed = act(createResumedSessionCoreState({ sessionId: `reward-${index}`,playerId: "host",displayName: "Host" },restored,context),{ type: "resume-adventure" });
      expect(resumed.adventure!.pendingReward).toEqual(reward.adventure!.pendingReward);
      state = claimChapterReward(resumed);
      expect(() => claimChapterReward(state)).toThrow();
    }
    const member = state.adventure!.party.members[HERO]!;
    const equipped = act(state,{ type: "set-loadout",memberId: HERO,loadout: { ...member.loadout,preparedCards: ["card.needle-darts","card.shield-spell"], equipment: { ...member.loadout.equipment,weapon: "sickle",shield: "dueling-cape" } } });
    const writer = createCampaignDurability({ campaigns: disk.persistence.campaigns,campaignId,ownerAccountId:account.accountId,campaignRevision:revision,now:()=>10 });
    await writer.commitGameplayTransition(state,equipped);
    const saved = disk.reopen().campaigns.loadOwnedSave(campaignId,account.accountId);
    if (saved.status !== "loaded") throw new Error("Missing completed save");
    const projection = restoreCampaignSave(saved.record,context).projection;
    const resumed = act(createResumedSessionCoreState({ sessionId:"chapter-complete",playerId:"host",displayName:"Host" },projection,context),{type:"resume-adventure"});
    expect(resumed.adventure).toEqual(equipped.adventure); expect(resumed.adventure!.phase).toBe("complete");
    expect(() => act(resumed,{type:"start-encounter"})).toThrow();
  } finally { await disk.close(); }
});
