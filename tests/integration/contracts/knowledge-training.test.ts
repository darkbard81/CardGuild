import { expect, it } from "vitest";
import { createCampaignDurability } from "../../../src/server/campaign-durability";
import { restoreCampaignSave } from "../../../src/server/campaign-save";
import { createResumedSessionCoreState, dispatchServerCombatCommand } from "../../../src/session";
import { diskStore, owner } from "../../support/storage";
import { HERO } from "../../support/session";
import { recruitedParty, tutorialWin, tutorialAct as act, tutorialContext as context } from "../../support/tutorial";

it("B-KNOWLEDGE-TRAINING SQLite reopen preserves consumed guarantee and unlocked detail on Resume", async () => {
  const disk = await diskStore();
  try {
    const account = owner(disk.persistence);
    const campaignId = "knowledge-training";
    disk.persistence.campaigns.create({ campaignId, ownerAccountId: account.accountId, name: "Training", campaignRevision: 0, hasSave: false, createdAt: 1, updatedAt: 1 });
    const writer = createCampaignDurability({ campaigns: disk.persistence.campaigns, campaignId, ownerAccountId: account.accountId, campaignRevision: 0, now: () => 2 });
    const ready = tutorialWin(recruitedParty(15, "human.wizard"));
    let state = act(ready, { type: "start-encounter" });
    for (let i = 0; i < 3 && state.combat!.turn.activeActorId !== HERO; i++) {
      const result = dispatchServerCombatCommand(state, { type: "end-turn", id: `turn-${i}`, sequence: -1,
        actorId: state.combat!.turn.activeActorId, facing: state.combat!.actors[state.combat!.turn.activeActorId]!.facing }, context);
      if (!result.accepted) throw new Error(result.error);
      state = result.state;
    }
    state = act(state, { type: "use-action", action: { kind: "basic", id: "recall-knowledge" }, target: { kind: "actor", actorId: "android-trainee" } });
    await writer.commitGameplayTransition(ready, state);
    const loaded = disk.reopen().campaigns.loadOwnedSave(campaignId, account.accountId);
    if (loaded.status !== "loaded") throw new Error("Missing committed knowledge save");
    const restored = restoreCampaignSave(loaded.record, context).projection;
    const resumed = act(createResumedSessionCoreState({ sessionId: "fresh-knowledge", playerId: "host", displayName: "Host" }, restored, context), { type: "resume-adventure" });
    expect(resumed.combat).toEqual(state.combat);
    expect(resumed.combat!.guaranteedCheckConsumed).toBe(true);
    expect(resumed.combat!.knowledge).toEqual([{ actorId: HERO, targetId: "android-trainee", success: true }]);
    expect(() => act(resumed, { type: "use-action", action: { kind: "basic", id: "recall-knowledge" }, target: { kind: "actor", actorId: "android-trainee" } })).toThrow();
  } finally { await disk.close(); }
});
