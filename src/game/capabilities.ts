import type { ActionDefinition, ActionSource, ActorStatProfile, CardDefinition, CombatContent, CombatState, LegalAction, TraitId, TraitInstance } from "./types";

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

export function isCardEligible(
  actor: { readonly statProfile: { readonly kind: ActorStatProfile["kind"] }; readonly traits: readonly TraitInstance[] },
  card: CardDefinition,
  content: Pick<CombatContent, "classes">,
): boolean {
  return actor.statProfile.kind === "creature" || matchesEligibilityGroups(card.traits, actor.traits, [content.classes]);
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
