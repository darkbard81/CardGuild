import type { ActorState, ConditionInstance, StatisticModifierContribution } from "./types";

export interface DerivedConditionEffect {
  readonly id: "immobilized" | "off-guard";
  readonly label: string;
  readonly blocksMovement?: boolean;
  readonly modifier?: StatisticModifierContribution;
}

const OFF_GUARD: DerivedConditionEffect = {
  id: "off-guard", label: "Off-guard · AC −2",
  modifier: { selector: { kind: "ac" }, type: "circumstance", value: -2, label: "Off-guard" },
};

/** Derived views, never additional persisted conditions. Removing the parent removes its effects. */
export function conditionEffects(condition: ConditionInstance): readonly DerivedConditionEffect[] {
  switch (condition.id) {
    case "grabbed": return [{ id: "immobilized", label: "Immobilized · 이동 제한", blocksMovement: true }, OFF_GUARD];
    case "prone": return [OFF_GUARD];
    default: return [];
  }
}

/** Prone keeps the existing Stand-before-movement contract; it is not Immobilized. */
export function conditionBlocksMovement(actor: Pick<ActorState, "conditions">): boolean {
  return actor.conditions.some(condition => condition.id === "prone" || conditionEffects(condition).some(effect => effect.blocksMovement));
}
