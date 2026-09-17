import { applyExperience } from "../../src/adventure";
import { createSqlitePersistence } from "../../src/server/persistence/sqlite-persistence";
import { restoreCampaignSave } from "../../src/server/campaign-save";
import { act, adventure, context, HERO, saveRecord } from "./session";

/** Validated pre-journey disk precondition. No debug route or fixture is served to the client. */
export function nearVictorySave(databasePath: string, accountId: string) {
  const ready = adventure();
  const member = ready.adventure!.party.members[HERO]!;
  const progressed = { ...ready, adventure: { ...ready.adventure!, party: { members: {
    [HERO]: { ...member, progression: applyExperience(member.progression, 1900).progression },
  } } } };
  const playing = act(progressed, { type: "start-encounter" });
  const combat = playing.combat!;
  const state = { ...playing, combat: { ...combat,
    turn: { ...combat.turn, activeActorId: HERO, activeIndex: combat.turn.initiativeOrder.indexOf(HERO) },
    actors: { ...combat.actors, "goblin-lackey": { ...combat.actors["goblin-lackey"]!, hp: 1 } },
  } };
  const record = { ...saveRecord(state), campaignId: "progress-checkpoint", ownerAccountId: accountId };
  restoreCampaignSave(record, context);
  const persistence = createSqlitePersistence(databasePath);
  try {
    persistence.campaigns.create({ campaignId: record.campaignId, ownerAccountId: accountId, name: "Growth checkpoint", campaignRevision: 0, hasSave: false, createdAt: 1, updatedAt: 1 });
    const saved = persistence.campaigns.commitSave({ ...record, expectedCampaignRevision: 0 });
    if (!saved.committed) throw new Error("Could not prepare journey checkpoint");
  } finally { persistence.close(); }
}
