import { listLegalActions, listLegalTargets, positionKey } from "../game";
import type { CombatContent, CombatState, LegalAction } from "../game";
import type { MoveBand, MoveBandTile } from "../pixi/BattleView";

/**
 * Cheapest movement first. A square Step can reach is drawn as a Step square even though
 * Stride reaches it too, so the rings read as "one square / a full move / only by air".
 */
export const MOVE_BAND_ORDER: readonly MoveBand[] = ["step", "stride", "fly"];

/** `null` for anything that is not a movement action. */
export function moveBandOf(action: LegalAction, content: CombatContent): MoveBand | null {
  const resolution = content.actions[action.actionId]?.resolution;
  if (!resolution || resolution.kind !== "move") return null;
  if (resolution.step) return "step";
  return resolution.movementMode === "fly" ? "fly" : "stride";
}

function collect(
  state: CombatState,
  actorId: string,
  content: CombatContent,
  actions: readonly { readonly action: LegalAction; readonly band: MoveBand }[],
): readonly MoveBandTile[] {
  const claimed = new Map<string, MoveBandTile>();
  for (const band of MOVE_BAND_ORDER) {
    for (const entry of actions) {
      if (entry.band !== band) continue;
      for (const target of listLegalTargets(state, actorId, entry.action.source, content)) {
        if (target.kind !== "tile") continue;
        const key = positionKey(target.position);
        // A cheaper band already owns this square; the first band to claim it wins.
        if (claimed.has(key)) continue;
        claimed.set(key, { position: target.position, band, costFeet: target.costFeet });
      }
    }
  }
  return [...claimed.values()].sort((left, right) =>
    left.position.y - right.position.y || left.position.x - right.position.x);
}

/** Every square this actor could move to right now, tagged with the movement that reaches it. */
export function moveBandsFor(
  state: CombatState,
  actorId: string,
  content: CombatContent,
): readonly MoveBandTile[] {
  const actions = listLegalActions(state, actorId, content).flatMap((action) => {
    if (!action.enabled) return [];
    const band = moveBandOf(action, content);
    return band ? [{ action, band }] : [];
  });
  return collect(state, actorId, content, actions);
}

/** The squares one chosen movement reaches, for when the player has already picked it. */
export function moveBandTilesFor(
  state: CombatState,
  actorId: string,
  content: CombatContent,
  action: LegalAction,
): readonly MoveBandTile[] {
  const band = moveBandOf(action, content);
  return band ? collect(state, actorId, content, [{ action, band }]) : [];
}
