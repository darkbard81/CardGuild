import { gridDistance, hasLineOfEffect, hasLineOfSight } from "./grid";
import { resolveStrike } from "./offense";
import { isDirectlyBehind, isInFrontOrSide } from "./rules";
import type { StatisticResolutionContext } from "./statistics";
import type { ActorState, CombatState, GridPosition, StatisticContextModifier } from "./types";

export type OffGuardCause = "rear" | "flanking";

/** The segment between centers must cross opposite edges of the target's unit square. */
export function crossesOppositeSides(a: GridPosition, b: GridPosition, target: GridPosition): boolean {
  const x = a.x - target.x;
  const y = a.y - target.y;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const crosses = (start: number, delta: number, other: number, otherDelta: number) => {
    if (delta === 0) return false;
    const first = (-0.5 - start) / delta;
    const second = (0.5 - start) / delta;
    return first > 0 && first < 1 && second > 0 && second < 1
      && Math.abs(other + first * otherDelta) <= 0.5
      && Math.abs(other + second * otherDelta) <= 0.5;
  };
  return crosses(x, dx, y, dy) || crosses(y, dy, x, dx);
}

/** Positional state belongs to the attacking relationship, never to Actor.conditions. */
export function resolveOffGuardTo(
  state: Pick<CombatState, "actors" | "map">,
  attacker: ActorState,
  target: ActorState,
  context: StatisticResolutionContext,
): { readonly partnerIds: readonly string[]; readonly offGuard: boolean; readonly causes: readonly OffGuardCause[]; readonly modifiers: readonly StatisticContextModifier[] } {
  const threatens = (actor: ActorState) => {
    const strike = resolveStrike(actor, context);
    // Creature fixed Strikes currently represent authored melee attacks (including reach).
    const melee = strike.attackMode === "melee" || strike.attackMode === null;
    return melee && !actor.defeated && !target.defeated && actor.team !== target.team
      && isInFrontOrSide(actor, target.position)
      && gridDistance(actor.position, target.position) <= strike.rangeFeet
      && hasLineOfSight(state.map, actor.position, target.position)
      && hasLineOfEffect(state.map, actor.position, target.position);
  };
  const causes: OffGuardCause[] = [];
  let partnerIds: string[] = [];
  if (threatens(attacker)) {
    if (isDirectlyBehind(attacker.position, target)) causes.push("rear");
    partnerIds = Object.values(state.actors).filter((ally) => ally.id !== attacker.id
      && ally.team === attacker.team && threatens(ally)
      && crossesOppositeSides(attacker.position, ally.position, target.position))
      .map((ally) => ally.id).sort();
    if (partnerIds.length) causes.push("flanking");
  }
  return {
    partnerIds,
    offGuard: causes.length > 0,
    causes,
    modifiers: causes.map((cause) => ({
      selector: { kind: "ac" }, type: "circumstance", value: -2,
      label: `Off-Guard (${cause})`, sourceId: `off-guard:${cause}`,
    })),
  };
}
