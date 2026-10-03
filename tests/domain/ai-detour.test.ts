import { expect, it } from "vitest";
import { createCombat } from "../../src/game";
import { chooseAiCommand } from "../../src/game/ai";
import { gridDistance } from "../../src/game/grid";
import { laneCombat, play } from "../support/combat";

it("G-WILLOW enemy pursuit takes a necessary step away from its target to escape a U-shaped shore", () => {
  const base = laneCombat();
  const blocked = new Set(["1,1", "2,1", "3,1", "1,2", "3,2"]);
  const definition = { ...base, scenario: { ...base.scenario,
    actors: base.scenario.actors.map(actor => ({ ...actor, speedFeet: 5, position: { x: 2, y: actor.team === "heroes" ? 0 : 2 } })),
    map: { width: 5, height: 5, objects: {}, tiles: Object.fromEntries(Array.from({ length: 25 }, (_, i) => {
      const x = i % 5, y = Math.floor(i / 5), key = `${x},${y}`;
      return [key, { id: key, position: { x, y }, traits: blocked.has(key) ? [{ id: "impassable" }] : [] }];
    })) },
  } };
  let state = createCombat(definition, 60).state;
  state = play(state, { type: "end-turn", actorId: "hero", facing: "south" }, definition);
  const first = chooseAiCommand(state, definition.content)!;
  expect(first).toMatchObject({ type: "use-action", actorId: "enemy", action: { kind: "basic", id: "stride" }, target: { kind: "tile", position: { x: 2, y: 3 } } });
  for (let i = 0; i < 30 && gridDistance(state.actors.hero!.position, state.actors.enemy!.position) > 5; i++) {
    const active = state.actors[state.turn.activeActorId]!;
    const next = active.team === "enemies" ? chooseAiCommand(state, definition.content)!
      : { type: "end-turn" as const, actorId: active.id, facing: active.facing };
    state = play(state, next, definition);
    expect(blocked.has(`${state.actors.enemy!.position.x},${state.actors.enemy!.position.y}`)).toBe(false);
  }
  expect(gridDistance(state.actors.hero!.position, state.actors.enemy!.position)).toBe(5);
});
