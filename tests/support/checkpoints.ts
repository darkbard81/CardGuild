import { applyExperience } from "../../src/adventure";
import { createSqlitePersistence } from "../../src/server/persistence/sqlite-persistence";
import { restoreCampaignSave } from "../../src/server/campaign-save";
import { HERO, saveRecord } from "./session";
import { tutorialAct as act, tutorialStart, tutorialContext as context, recruitedParty } from "./tutorial";
import type { SessionCoreState } from "../../src/session";

/** Validated pre-journey disk precondition. No debug route or fixture is served to the client. */
export function nearVictorySave(databasePath: string, accountId: string) {
  const ready = tutorialStart(60);
  const member = ready.adventure!.party.members[HERO]!;
  const progressed = { ...ready, adventure: { ...ready.adventure!, party: { members: {
    [HERO]: { ...member, progression: applyExperience(member.progression, 1900).progression },
  } } } };
  const playing = act(progressed, { type: "start-encounter" });
  const combat = playing.combat!;
  const state = { ...playing, combat: { ...combat,
    turn: { ...combat.turn, activeActorId: HERO, activeIndex: combat.turn.initiativeOrder.indexOf(HERO) },
    actors: { ...combat.actors, "slime-trainee": { ...combat.actors["slime-trainee"]!, hp: 1 } },
  } };
  persistCheckpoint(databasePath, accountId, state, "progress-checkpoint");
}
export function recruitedSave(databasePath: string, accountId: string) {
  persistCheckpoint(databasePath, accountId, recruitedParty(), "coop-checkpoint");
}
function persistCheckpoint(databasePath: string, accountId: string, state: SessionCoreState, campaignId: string) {
  const record = { ...saveRecord(state), campaignId, ownerAccountId: accountId };
  restoreCampaignSave(record, context);
  const persistence = createSqlitePersistence(databasePath);
  try {
    persistence.campaigns.create({ campaignId, ownerAccountId: accountId, name: "Journey checkpoint", campaignRevision: 0, hasSave: false, createdAt: 1, updatedAt: 1 });
    const saved = persistence.campaigns.commitSave({ ...record, expectedCampaignRevision: 0 });
    if (!saved.committed) throw new Error("Could not prepare journey checkpoint");
  } finally { persistence.close(); }
}
