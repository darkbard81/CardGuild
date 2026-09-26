import { resolveOffGuardTo } from "./off-guard";
import type { ActorState, CombatContent, CombatState } from "./types";

/** Shared by execution and preview; positional immunity is never an Actor condition. */
export function damagePrevention(
  state: Pick<CombatState, "rules" | "actors" | "map">,
  source: ActorState,
  target: ActorState,
  content: CombatContent,
): "requires-flanking" | undefined {
  if (state.rules?.damageRequiresFlanking === target.team &&
      !resolveOffGuardTo(state, source, target, { content }).causes.includes("flanking")) {
    return "requires-flanking";
  }
  return undefined;
}
