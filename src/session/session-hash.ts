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
    roster: [...state.seats]
      .sort((left, right) => left.seat - right.seat)
      .map(({ seat, memberId, actorDefinitionId }) => ({ seat, memberId, actorDefinitionId })),
    adventure: state.adventure,
    combat: state.combat,
  });
}
