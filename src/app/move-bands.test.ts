import { describe, expect, it } from "vitest";

import {
  cloneM0Scenario,
  M0_CONTENT,
  M0_CONTENT_IDENTITY,
  M0_DEFAULT_SEED,
} from "../content/load-m0-content";
import { createCombat } from "../game/engine";
import { listLegalActions, listLegalTargets, positionKey } from "../game";
import type { ActorState, CombatState, LegalAction } from "../game";
import { moveBandOf, moveBandsFor, moveBandTilesFor } from "./move-bands";

/**
 * The Ruined Gate fixture is a real board: the hero stands at (1,3) with Speed 25,
 * (2,3) beside them is difficult ground, and (3,4)/(3,5) are impassable. That is every
 * case the bands have to tell apart.
 */
function ruinedGate(): { state: CombatState; hero: ActorState } {
  const state = createCombat(
    { scenario: cloneM0Scenario(), content: M0_CONTENT, contentIdentity: M0_CONTENT_IDENTITY },
    M0_DEFAULT_SEED,
  ).state;
  const hero = Object.values(state.actors).find((actor) => actor.team === "heroes");
  if (!hero) throw new Error("The Ruined Gate fixture has no hero.");
  return { state, hero };
}

function bandAt(state: CombatState, hero: ActorState, x: number, y: number): string | undefined {
  return moveBandsFor(state, hero.id, M0_CONTENT)
    .find((tile) => tile.position.x === x && tile.position.y === y)?.band;
}

function moveAction(state: CombatState, hero: ActorState, actionId: string): LegalAction {
  const action = listLegalActions(state, hero.id, M0_CONTENT)
    .find((candidate) => candidate.actionId === actionId);
  if (!action) throw new Error(`The hero cannot ${actionId}.`);
  return action;
}

describe("move bands", () => {
  it("names the movement that reaches a square", () => {
    const { state, hero } = ruinedGate();
    expect(moveBandOf(moveAction(state, hero, "step"), M0_CONTENT)).toBe("step");
    expect(moveBandOf(moveAction(state, hero, "stride"), M0_CONTENT)).toBe("stride");
    expect(moveBandOf(moveAction(state, hero, "fly"), M0_CONTENT)).toBe("fly");
    // Everything that is not a move resolution stays out of the bands entirely.
    expect(moveBandOf(moveAction(state, hero, "strike"), M0_CONTENT)).toBeNull();
  });

  it("gives a square the cheapest movement that reaches it", () => {
    const { state, hero } = ruinedGate();
    expect(hero.position).toEqual({ x: 1, y: 3 });
    // Adjacent and open: one Step is enough, even though Stride and Fly reach them too.
    expect(bandAt(state, hero, 1, 2)).toBe("step");
    expect(bandAt(state, hero, 0, 3)).toBe("step");
    expect(bandAt(state, hero, 1, 4)).toBe("step");
    // Adjacent but difficult, so Step cannot end there and Stride pays double.
    expect(bandAt(state, hero, 2, 3)).toBe("stride");
    // Impassable on foot: only the flier gets there.
    expect(bandAt(state, hero, 3, 4)).toBe("fly");
    expect(bandAt(state, hero, 3, 5)).toBe("fly");
  });

  it("covers exactly the squares the movement actions accept, once each", () => {
    const { state, hero } = ruinedGate();
    const bands = moveBandsFor(state, hero.id, M0_CONTENT);
    // Fly is granted by gear rather than being a basic action, so the oracle asks each
    // movement through the source the actor actually has it from.
    const union = new Set(["step", "stride", "fly"].flatMap((actionId) =>
      listLegalTargets(state, hero.id, moveAction(state, hero, actionId).source, M0_CONTENT)
        .flatMap((target) => (target.kind === "tile" ? [positionKey(target.position)] : []))));
    const keys = bands.map((tile) => positionKey(tile.position));
    expect(new Set(keys)).toEqual(union);
    expect(keys.length).toBe(new Set(keys).size);
    // Row-major order keeps the overlay and this test stable across runs.
    expect(keys).toEqual([...bands]
      .sort((left, right) => left.position.y - right.position.y || left.position.x - right.position.x)
      .map((tile) => positionKey(tile.position)));
  });

  it("reports one chosen movement in its own colour, band ordering aside", () => {
    const { state, hero } = ruinedGate();
    const stride = moveBandTilesFor(state, hero.id, M0_CONTENT, moveAction(state, hero, "stride"));
    // The player picked Stride, so a neighbouring square is a Stride square now.
    expect(stride.find((tile) => tile.position.x === 1 && tile.position.y === 2)?.band).toBe("stride");
    expect(stride.every((tile) => tile.band === "stride")).toBe(true);
    // Fly reaches the impassable squares Stride cannot.
    const fly = moveBandTilesFor(state, hero.id, M0_CONTENT, moveAction(state, hero, "fly"));
    expect(fly.some((tile) => tile.position.x === 3 && tile.position.y === 4)).toBe(true);
    expect(stride.some((tile) => tile.position.x === 3 && tile.position.y === 4)).toBe(false);
  });

  it("has nothing to draw for an action that is not a movement", () => {
    const { state, hero } = ruinedGate();
    expect(moveBandTilesFor(state, hero.id, M0_CONTENT, moveAction(state, hero, "strike"))).toEqual([]);
  });
});
