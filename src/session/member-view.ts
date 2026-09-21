import { resolvePartyMemberDefinition } from "../character/member";
import type { CompiledContentPack } from "../content/content-types";
import type { SessionCoreState, SessionPartySlot } from "./types";

/** Lobby templates and saved members share one presentation projection. */
export function resolveSessionPartyDefinition(state: SessionCoreState, slot: SessionPartySlot | undefined, pack: CompiledContentPack) {
  if (!slot) return undefined;
  return resolvePartyMemberDefinition(state.adventure?.party.members[slot.memberId] ?? slot, pack);
}
