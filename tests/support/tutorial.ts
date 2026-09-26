import { deriveCombatSeed, dispatchAdventureCommand } from "../../src/adventure";
import { PRODUCTION_CONTENT } from "../../src/content/production-content";
import { createSessionCoreState, dispatchSessionIntent, dispatchServerCombatCommand, type SessionCoreState, type SessionIntent } from "../../src/session";
export const tutorialContext = { pack: PRODUCTION_CONTENT.pack, adventureId: PRODUCTION_CONTENT.adventureId };
export const tutorialRuntime = { ...tutorialContext.pack, definition: PRODUCTION_CONTENT.adventure };
export function tutorialAct(state: SessionCoreState, intent: SessionIntent) {
  const result = dispatchSessionIntent(state, "host", intent, tutorialContext, { connectedPlayerIds: ["host"],
    effectiveControllerByMemberId: Object.fromEntries(state.partySlots.map(slot => [slot.memberId, "host"])) });
  if (!result.accepted) throw new Error(result.error);
  return result.state;
}
export function tutorialStart(seed = 68, preset = "human.fighter", gender: "male" | "female" = "female") {
  return tutorialAct(createSessionCoreState({ sessionId: "tutorial-68", playerId: "host", displayName: "Host", adventureSeed: seed }, tutorialContext),
    { type: "create-character", name: "Arlen", gender, creationPresetId: preset });
}
/** Public victory transition for preconditions whose owner is not combat resolution. */
export function tutorialWin(state: SessionCoreState) {
  const adventure = state.adventure!;
  const encounterId = adventure.currentEncounterId!;
  const result = dispatchAdventureCommand({ ...adventure, phase: "combat" }, { type: "accept-combat-result", result: {
    encounterId, outcome: "victory", combatSeed: deriveCombatSeed(state.adventureSeed, encounterId), finalCombatHash: "fixture-victory",
  } }, tutorialRuntime);
  if (!result.accepted) throw new Error(result.error);
  return { ...state, combat: null, revision: state.revision + 1, adventure: result.state };
}
export function trainingReady(seed = 68, preset = "human.fighter", gender: "male" | "female" = "female") {
  const won = tutorialWin(tutorialStart(seed, preset, gender));
  return tutorialAct(won, { type: "choose-reward", rewardId: won.adventure!.pendingReward!.rewardId, choiceIndex: 0 });
}
export function resolveOpening(state: SessionCoreState) {
  const opening = state.combat!.rules!.opening!;
  const result = dispatchServerCombatCommand(state, { type: "use-action", id: "opening-fixture", sequence: -1,
    actorId: opening.actorId, action: { kind: "innate", id: opening.actionId },
    target: { kind: "actor", actorId: state.combat!.opening!.targetActorId } }, tutorialContext);
  if (!result.accepted) throw new Error(result.error);
  return result;
}
export function recruitedParty() {
  const won = tutorialWin(trainingReady(60));
  return tutorialAct(won, { type: "choose-reward", rewardId: won.adventure!.pendingReward!.rewardId, choiceIndex: 0 });
}
