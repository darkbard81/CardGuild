import type { ActionSource, CardZones, CombatContent } from "../../src/game/types";

/** A real instance for low-level plan tests that do not need a shuffled encounter. */
export function cardPlanSource(content: CombatContent, actionId: string, actorId: string): {
  source: ActionSource;
  cardZones: Record<string, CardZones>;
} {
  const card = Object.values(content.cards).find(card => card.actionId === actionId);
  if (!card) throw new Error(`No Card defines ${actionId}.`);
  const id = `plan-${actorId}-${card.id}`;
  return {
    source: { kind: "card", id },
    cardZones: { [actorId]: { hand: [{ id, definitionId: card.id, source: { kind: "prepared", memberId: actorId } }], drawPile: [], discardPile: [] } },
  };
}
