import type {
  CardGrant,
  ActorState,
  CombatContent,
  ConditionDefinition,
  Direction,
  EquipmentDefinition,
  GridPosition,
  TraitInstance,
  WeaponProfile,
} from "./types";

export function hasTrait(
  source: { readonly traits: readonly TraitInstance[] },
  traitId: string,
): boolean {
  return source.traits.some((trait) => trait.id === traitId);
}

export function getEquipment(
  actor: ActorState,
  content: CombatContent,
): readonly EquipmentDefinition[] {
  return actor.equipmentIds.flatMap((id) => {
    const equipment = content.equipment[id];
    return equipment ? [equipment] : [];
  });
}

export function getEquipmentCardGrants(
  actor: ActorState,
  content: CombatContent,
): readonly CardGrant[] {
  return getEquipment(actor, content).flatMap((equipment) =>
    equipment.traits.flatMap((trait) => {
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
  actor: ActorState,
  content: CombatContent,
) {
  return getEquipment(actor, content).flatMap((equipment) =>
    equipment.traits.flatMap((trait) => content.traits[trait.id]?.actionGrants ?? []),
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

export function getWeaponProfile(actor: ActorState, content: CombatContent): WeaponProfile {
  return (
    getEquipment(actor, content).find((equipment) => equipment.weaponProfile)?.weaponProfile ??
    actor.fallbackWeapon
  );
}

export function getStatistic(
  actor: ActorState,
  content: CombatContent,
  selector: "ac" | "reflex",
): { readonly value: number; readonly sources: readonly string[] } {
  const base = selector === "ac" ? actor.baseAc : actor.reflexModifier + 10;
  const sources: string[] = [`Base ${selector.toUpperCase()} ${base}`];
  let value = base;

  for (const equipment of getEquipment(actor, content)) {
    for (const modifier of equipment.statModifiers) {
      if (modifier.selector === selector) {
        value += modifier.value;
        sources.push(`${modifier.label} ${modifier.value >= 0 ? "+" : ""}${modifier.value}`);
      }
    }
  }

  if (selector === "ac" && actor.shieldRaised) {
    const shield = getEquipment(actor, content).find((equipment) => equipment.shieldBonus);
    if (shield?.shieldBonus) {
      value += shield.shieldBonus;
      sources.push(`${shield.name} +${shield.shieldBonus}`);
    }
  }

  return { value, sources };
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
