import { deriveCombatSeed, dispatchAdventureCommand } from "../../src/adventure";
import { PRODUCTION_CONTENT } from "../../src/content/production-content";
import { createSessionCoreState, dispatchSessionIntent, type SessionCoreState, type SessionIntent } from "../../src/session";

export const recruitmentContext = { pack: PRODUCTION_CONTENT.pack, adventureId: "adventure.recruitment-tutorial" };
export const recruitmentRuntime = { ...recruitmentContext.pack, definition: recruitmentContext.pack.adventures[recruitmentContext.adventureId]! };
export const recruitIntent = { type: "choose-reward", rewardId: "reward.recruit-aerin", choiceIndex: 0 } as const;
export function recruitmentDispatch(state: SessionCoreState, intent: SessionIntent) {
  return dispatchSessionIntent(state, "host", intent, recruitmentContext, { connectedPlayerIds: ["host"],
    effectiveControllerByMemberId: Object.fromEntries(state.partySlots.map(slot => [slot.memberId, "host"])) });
}
export function recruitmentAct(state: SessionCoreState, intent: SessionIntent) {
  const result = recruitmentDispatch(state, intent);
  if (!result.accepted) throw new Error(result.error);
  return result.state;
}
export function recruitmentStart() {
  const lobby = createSessionCoreState({ sessionId: "recruitment-65", playerId: "host", displayName: "Host", adventureSeed: 65 }, recruitmentContext);
  return recruitmentAct(lobby, { type: "create-character", name: "하늘", gender: "female", creationPresetId: "human.fighter" });
}
/** Public victory transition; combat input setup is not the contract under test here. */
export function recruitmentReward() {
  const state = recruitmentStart();
  const adventure = state.adventure!;
  const encounterId = adventure.currentEncounterId!;
  const result = dispatchAdventureCommand({ ...adventure, phase: "combat" }, { type: "accept-combat-result", result: {
    encounterId, outcome: "victory", combatSeed: deriveCombatSeed(state.adventureSeed, encounterId), finalCombatHash: "fixture-victory",
  } }, recruitmentRuntime);
  if (!result.accepted) throw new Error(result.error);
  return { ...state, revision: state.revision + 1, adventure: result.state };
}
