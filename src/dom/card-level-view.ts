import type { CardDefinition, CombatContent } from "../game/types";
import { resolveCardEligibility, type CardEligibilityActor } from "../game/capabilities";

export function cardLevelSummary(card: CardDefinition, content: CombatContent, actor?: CardEligibilityActor): string {
  if (actor) {
    const result = resolveCardEligibility(actor, card, content);
    return requirementText(result);
  }
  const overrides = Object.entries(card.levelByClass ?? {}).sort(([a], [b]) => a.localeCompare(b))
    .map(([id, level]) => `${content.traits[id]?.name ?? id} ${level}`);
  return `요구 레벨 ${card.level}${overrides.length ? ` · ${overrides.join(" / ")}` : ""}`;
}

export function requirementText(requirement: { readonly requiredLevel: number; readonly currentLevel?: number }): string {
  return `요구 레벨 ${requirement.requiredLevel}${requirement.currentLevel === undefined ? "" : ` · 현재 레벨 ${requirement.currentLevel}`}`;
}
