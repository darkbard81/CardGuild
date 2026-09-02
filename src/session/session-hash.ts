import { fingerprintValue } from "../game/determinism";
import type { ContentIdentity } from "../game";
import type { SessionCoreState } from "./types";

export function sameContentIdentity(left: ContentIdentity, right: ContentIdentity): boolean {
  return left.packId === right.packId &&
    left.packVersion === right.packVersion &&
    left.fingerprint === right.fingerprint;
}
export function hashSessionGameplayState(state: SessionCoreState): string {
  return fingerprintValue({
    contentIdentity: state.contentIdentity,
    party: [...state.partySlots]
      .sort((left, right) => left.slot - right.slot)
      .map(({ slot, memberId, actorDefinitionId }) => ({ slot, memberId, actorDefinitionId })),
    adventure: state.adventure,
    combat: state.combat,
  });
}
