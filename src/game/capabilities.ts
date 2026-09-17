import type { ActionDefinition, ActionSource, CardDefinition, CombatContent, CombatState, ContextActionGroup, LegalAction, TraitId, TraitInstance } from "./types";

/** Context providers may expose only these Basic actions, never arbitrary Card capabilities. */
const CONTEXTUAL_BASIC_ACTIONS: Readonly<Record<ContextActionGroup, readonly string[]>> = {
  escape: ["stand", "escape-grab"],
  interact: ["interact-lever"],
  shield: ["raise-shield"],
  sustain: ["sustain-spell"],
};

export function isContextualBasicAction(actionId: string, group: ContextActionGroup): boolean {
  return Object.hasOwn(CONTEXTUAL_BASIC_ACTIONS, group) && CONTEXTUAL_BASIC_ACTIONS[group].includes(actionId);
}

/** OR within each identity registry, AND across registries; categories never dispatch rules. */
export function matchesEligibilityGroups(
  cardTraits: readonly TraitInstance[],
  actorTraits: readonly TraitInstance[],
  registries: readonly Readonly<Record<TraitId, unknown>>[],
): boolean {
  const identities = new Set(actorTraits.map(trait => trait.id));
  return registries.every(registry => {
    const required = cardTraits.filter(trait => Object.hasOwn(registry, trait.id));
    return required.length === 0 || required.some(trait => identities.has(trait.id));
  });
}

export interface CardEligibilityActor {
  readonly statProfile: { readonly kind: "character"; readonly stats: { readonly level: number } } | { readonly kind: "creature" };
  readonly traits: readonly TraitInstance[];
}

export type CardEligibility = {
  readonly requiredLevel: number;
  readonly currentLevel?: number;
} & ({ readonly eligible: true } | {
  readonly eligible: false;
  readonly code: "INELIGIBLE_CARD" | "CARD_LEVEL_TOO_LOW";
  readonly reason: string;
});

/** Provider provenance never overrides the capability's Class or level requirements. */
export function resolveCardEligibility(
  actor: CardEligibilityActor,
  card: CardDefinition,
  content: Pick<CombatContent, "classes">,
): CardEligibility {
  if (actor.statProfile.kind === "creature") return { eligible: true, requiredLevel: card.level };
  const matchingClasses = card.traits.filter(trait => Object.hasOwn(content.classes, trait.id)
    && actor.traits.some(identity => identity.id === trait.id));
  const requiredLevel = matchingClasses.length
    ? Math.min(...matchingClasses.map(trait => card.levelByClass?.[trait.id] ?? card.level)) : card.level;
  const currentLevel = actor.statProfile.stats.level;
  if (!matchesEligibilityGroups(card.traits, actor.traits, [content.classes])) {
    return { eligible: false, requiredLevel, currentLevel, code: "INELIGIBLE_CARD", reason: `${card.name}: Class 조건을 충족하지 않습니다.` };
  }
  if (!Number.isSafeInteger(currentLevel) || !Number.isSafeInteger(requiredLevel) || requiredLevel < 1 || currentLevel < requiredLevel) {
    return { eligible: false, requiredLevel, currentLevel, code: "CARD_LEVEL_TOO_LOW", reason: `${card.name}: 요구 레벨 ${requiredLevel} · 현재 레벨 ${currentLevel}` };
  }
  return { eligible: true, requiredLevel, currentLevel };
}

export function isCardEligible(actor: CardEligibilityActor, card: CardDefinition, content: Pick<CombatContent, "classes">): boolean {
  return resolveCardEligibility(actor, card, content).eligible;
}

/** Card instance identity survives hand/discard/shuffle; never fall back to Action traits. */
export function resolveEffectiveActionTraits(
  source: ActionSource,
  definition: ActionDefinition,
  state: Pick<CombatState, "cardZones">,
  content: CombatContent,
  actorId: string,
): readonly TraitId[] {
  if (source.kind !== "card") return definition.traits.map(trait => trait.id);
  const zones = state.cardZones[actorId];
  if (!zones) return [];
  const card = zones.hand.find(card => card.id === source.id)
    ?? zones.drawPile.find(card => card.id === source.id)
    ?? zones.discardPile.find(card => card.id === source.id);
  return card ? content.cards[card.definitionId]?.traits.map(trait => trait.id) ?? [] : [];
}

export function isRingAction(action: Pick<LegalAction, "source">): boolean {
  return action.source.kind === "basic" || action.source.kind === "context";
}

export function canUseRuleTraits(state: CombatState, actorId: string, traits: readonly TraitId[]): boolean {
  return !traits.includes("flourish") || !(state.turn.usedTraitsByActor[actorId] ?? []).includes("flourish");
}
