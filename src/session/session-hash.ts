import { fingerprintValue } from "../game/determinism";
import type { ContentIdentity } from "../game";
import type { SessionGameplayHashInput } from "./types";

export function sameContentIdentity(left: ContentIdentity, right: ContentIdentity): boolean {
  return left.packId === right.packId &&
    left.packVersion === right.packVersion &&
    left.fingerprint === right.fingerprint;
}
/**
 * The canonical gameplay hash. It reads only what a durable Campaign save holds, so a
 * restored session hashes identically to the session it was saved from, and live-only
 * identity — session/player IDs, guest claims, presence, revision — cannot change it.
 */
export function hashSessionGameplayState(state: SessionGameplayHashInput): string {
  return fingerprintValue({
    contentIdentity: state.contentIdentity,
    party: [...state.partySlots]
      .sort((left, right) => left.slot - right.slot)
      .map(({ slot, memberId, actorDefinitionId }) => ({ slot, memberId, actorDefinitionId })),
    adventure: state.adventure,
    combat: state.combat,
  });
}
