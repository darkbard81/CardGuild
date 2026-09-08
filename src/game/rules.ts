import type {
  CardGrant,
  ActorState,
  CombatContent,
  ConditionDefinition,
  Direction,
  EquipmentDefinition,
  GridPosition,
  TraitInstance,
} from "./types";

export function hasTrait(
  source: { readonly traits: readonly TraitInstance[] },
  traitId: string,
): boolean {
  return source.traits.some((trait) => trait.id === traitId);
}

export function getEquipment(
  actor: Pick<ActorState, "equipmentIds">,
  content: CombatContent,
): readonly EquipmentDefinition[] {
  return actor.equipmentIds.flatMap((id) => {
    const equipment = content.equipment[id];
    return equipment ? [equipment] : [];
  });
}

/**
 * The one effective Trait set an Equipment carries. A weapon may name Traits on the
 * definition or inside its weapon profile; both reach the Strike resolver, the card and
 * action providers, and the statistic modifier stack through this function, so the same
 * Trait ID can never exist for one boundary and be missing from another.
 */
export function equipmentTraits(equipment: EquipmentDefinition): readonly TraitInstance[] {
  const seen = new Set<string>();
  return [...equipment.traits, ...(equipment.weaponProfile?.traits ?? [])].filter((trait) => {
    if (seen.has(trait.id)) return false;
    seen.add(trait.id);
    return true;
  });
}

export function getEquipmentCardGrants(
  actor: Pick<ActorState, "equipmentIds">,
  content: CombatContent,
): readonly CardGrant[] {
  return getEquipment(actor, content).flatMap((equipment) =>
    equipmentTraits(equipment).flatMap((trait) => {
      const definition = content.traits[trait.id];
      return (definition?.cardGrants ?? []).map((grant) => ({
        ...grant,
        sourceId: equipment.id,
        traitId: trait.id,
      }));
    }),
  );
}

export function getEquipmentActionGrants(
  actor: Pick<ActorState, "equipmentIds">,
  content: CombatContent,
) {
  return getEquipment(actor, content).flatMap((equipment) =>
    equipmentTraits(equipment).flatMap((trait) => content.traits[trait.id]?.actionGrants ?? []),
  );
}

export function getConditionDefinitions(
  actor: ActorState,
  content: CombatContent,
): readonly ConditionDefinition[] {
  return actor.conditions.flatMap((condition) => {
    const definition = content.conditions[condition.id];
    return definition ? [definition] : [];
  });
}

export function getConditionActionGrants(
  actor: ActorState,
  content: CombatContent,
) {
  return getConditionDefinitions(actor, content).flatMap((condition) =>
    condition.traits.flatMap((trait) => content.traits[trait.id]?.actionGrants ?? []),
  );
}

export const DIRECTION_VECTORS: Readonly<Record<Direction, GridPosition>> = {
  north: { x: 0, y: -1 },
  east: { x: 1, y: 0 },
  south: { x: 0, y: 1 },
  west: { x: -1, y: 0 },
};

export function isInFrontOrSide(actor: ActorState, target: GridPosition): boolean {
  const vector = DIRECTION_VECTORS[actor.facing];
  const dx = target.x - actor.position.x;
  const dy = target.y - actor.position.y;
  return dx !== 0 || dy !== 0 ? dx * vector.x + dy * vector.y >= 0 : false;
}

export function isDirectlyBehind(attacker: GridPosition, target: ActorState): boolean {
  const facing = DIRECTION_VECTORS[target.facing];
  return attacker.x === target.position.x - facing.x && attacker.y === target.position.y - facing.y;
}

export function facingToward(from: GridPosition, to: GridPosition): Direction {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) >= Math.abs(dy) && dx !== 0) return dx > 0 ? "east" : "west";
  if (dy !== 0) return dy > 0 ? "south" : "north";
  return "north";
}

export function isSuccessful(degree: DegreeOfSuccessLike): boolean {
  return degree === "success" || degree === "critical-success";
}

type DegreeOfSuccessLike = "critical-success" | "success" | "failure" | "critical-failure";
