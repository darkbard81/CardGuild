import { dispatchAdventureCommand } from "../../src/adventure";
import { createCampaignSave, restoreCampaignSave } from "../../src/server/campaign-save";
import { createResumedSessionCoreState } from "../../src/session";
import { act, adventure, adventureContext, context, saveRecord } from "./session";
import { recruitmentAct, recruitmentContext, recruitmentReward, recruitmentRuntime, recruitIntent } from "./recruitment";

/** Settle a public Combat result, then pass the real save validator before restoring. */
export function restoredCoopCheckpoint(phase: "reward" | "complete" | "failed") {
  const runtime = phase === "reward" ? adventureContext : recruitmentRuntime;
  const authority = phase === "reward" ? context : recruitmentContext;
  const combat = phase === "reward"
    ? act(adventure(true), { type: "start-encounter" })
    : recruitmentAct(recruitmentAct(recruitmentReward(), recruitIntent), { type: "start-encounter" });
  const result = dispatchAdventureCommand(combat.adventure!, { type: "accept-combat-result", result: {
    encounterId: combat.adventure!.currentEncounterId!, outcome: phase === "failed" ? "defeat" : "victory",
    combatSeed: combat.combat!.seed, finalCombatHash: "coop-phase-checkpoint",
  } }, runtime);
  if (!result.accepted || result.state.phase !== phase) throw new Error(result.error ?? `Expected ${phase} checkpoint`);
  const checkpoint = { ...combat, adventure: result.state, combat: null };
  const saved = createCampaignSave(checkpoint);
  const projection = restoreCampaignSave(saveRecord(checkpoint), authority).projection;
  const state = createResumedSessionCoreState({ sessionId: `resume-${phase}`, playerId: "host", displayName: "Host" }, projection, authority);
  return { state, context: authority, saved };
}
