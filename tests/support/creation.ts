import { compileContentPack } from "../../src/content/compile-content";
import { M7_CONTENT_SOURCE, M7_ADVENTURE_ID } from "../../src/content/load-m7-content";
import { createSessionCoreState, dispatchSessionIntent, type SessionCoreState, type SessionIntent } from "../../src/session";

/** Representative authoring fixtures, not a production launch roster (#64). */
export const creationSource = { ...M7_CONTENT_SOURCE, creationPresets: [
  { id: "test.human-fighter", actorDefinitionId: "hero.aerin", appearance: { male: "hero.aerin", female: "hero.nera" } },
  { id: "test.human-cleric", actorDefinitionId: "hero.nera", appearance: { male: "hero.aerin", female: "hero.nera" } },
] };
export const creationContext = { pack: compileContentPack(creationSource), adventureId: M7_ADVENTURE_ID };
export const creationIntent = { type: "create-character", name: "하늘", gender: "female", creationPresetId: "test.human-fighter" } as const;
export function creationLobby(sessionId = "creation-one") {
  return createSessionCoreState({ sessionId, playerId: "host", displayName: "Account name", adventureSeed: 63 }, creationContext);
}
export function creationDispatch(state: SessionCoreState, intent: SessionIntent, playerId = "host") {
  return dispatchSessionIntent(state, playerId, intent, creationContext, {
    connectedPlayerIds: state.seats.map(seat => seat.playerId),
    effectiveControllerByMemberId: Object.fromEntries(state.partySlots.map(slot => [slot.memberId, "host"])),
  });
}
export function creationAct(state: SessionCoreState, intent: SessionIntent): SessionCoreState {
  const result = creationDispatch(state, intent);
  if (!result.accepted) throw new Error(result.error);
  return result.state;
}
