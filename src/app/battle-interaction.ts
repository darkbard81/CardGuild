import type { GridPosition, LegalAction, LegalTarget } from "../game";

/** One radial menu entry: an action already bound to the board target that was picked. */
export interface RingEntry {
  readonly id: string;
  readonly action: LegalAction;
  readonly target: LegalTarget;
  /** Interchangeable copies of the same card collapse into one entry. */
  readonly copies: number;
}

/**
 * What the next board click means. Keeping the phases in one discriminated union stops
 * stale ring entries or a dangling destination from surviving into an unrelated phase,
 * and gives later targeting modes (AoE, multi-target, drag) one place to plug into.
 *
 * idle   → a board pick opens the ring menu.
 * card   → a card is chosen first; a board pick resolves against its legal targets.
 * ring   → the radial menu is open on `position`; only ring input is accepted.
 * facing → a destination is locked in; the board's four wedges finish the move.
 */
export type Interaction =
  | { readonly kind: "idle" }
  | { readonly kind: "card"; readonly action: LegalAction }
  | {
      readonly kind: "ring";
      readonly position: GridPosition;
      readonly entries: readonly RingEntry[];
      readonly hoveredOptionId: string | null;
    }
  | { readonly kind: "facing"; readonly action: LegalAction; readonly position: GridPosition };

export const IDLE_INTERACTION: Interaction = { kind: "idle" };

/** The action the HUD should show as chosen, if any. */
export function interactionAction(interaction: Interaction): LegalAction | null {
  switch (interaction.kind) {
    case "card":
    case "facing":
      return interaction.action;
    case "ring":
      return hoveredRingEntry(interaction)?.action ?? null;
    case "idle":
      return null;
  }
}

export function hoveredRingEntry(interaction: Interaction): RingEntry | null {
  if (interaction.kind !== "ring" || !interaction.hoveredOptionId) return null;
  return interaction.entries.find((entry) => entry.id === interaction.hoveredOptionId) ?? null;
}
