import { expect, it } from "vitest";
import { buildAdventureEncounter } from "../../src/adventure";
import { createCombatReplay, dispatchCombatCommand, replayCombat } from "../../src/game";
import { movementCost } from "../../src/game/grid";
import { restoreCampaignSave } from "../../src/server/campaign-save";
import { createResumedSessionCoreState } from "../../src/session";
import { command, play } from "../support/combat";
import { HERO, saveRecord } from "../support/session";
import { recruitedParty, tutorialWin, tutorialAct as act, tutorialContext as context } from "../support/tutorial";

const ready = () => tutorialWin(tutorialWin(recruitedParty(60)));
const destroy = { kind: "context", id: "destroy-obstacle" } as const;
it("G-WILLOW the 20×20 forest has three ground materials, water, accessible enemies and separate blockers", () => {
  const session = act(ready(), { type: "start-encounter" });
  const state = session.combat!;
  expect(state.scenarioId).toBe("encounter.willow-rescue");
  expect([state.map.width, state.map.height, Object.keys(state.map.tiles).length]).toEqual([20, 20, 400]);
  expect(state.partyHpFloor).toBeUndefined(); expect(state.rules).toBeUndefined();
  const tiles = Object.values(state.map.tiles);
  for (const material of ["forest-grass", "forest-dirt", "forest-leaves", "pond-water"])
    expect(tiles.some(tile => tile.traits.some(t => t.id === material))).toBe(true);
  for (const tile of tiles.filter(tile => tile.traits.some(t => t.id === "pond-water"))) expect(movementCost(tile, "land")).toBeNull();
  const reached = new Set<string>(); const queue = [state.actors[HERO]!.position];
  while (queue.length) {
    const p = queue.shift()!; const key = `${p.x},${p.y}`;
    if (reached.has(key) || !state.map.tiles[key] || movementCost(state.map.tiles[key]!, "land") === null) continue;
    reached.add(key); queue.push({ x: p.x + 1, y: p.y }, { x: p.x - 1, y: p.y }, { x: p.x, y: p.y + 1 }, { x: p.x, y: p.y - 1 });
  }
  for (const actor of Object.values(state.actors)) expect(reached.has(`${actor.position.x},${actor.position.y}`), actor.id).toBe(true);
  expect(Object.values(state.actors).filter(a => a.team === "enemies").map(a => a.definitionId).sort()).toEqual(["enemy.dark-elf-archer", "enemy.dark-elf-mage", "enemy.dark-elf-rogue", "enemy.dark-elf-warrior"]);
  for (const object of Object.values(state.map.objects)) {
    expect(object.interaction.kind).toBe("destroy-obstacle");
    expect(movementCost(state.map.tiles[`${object.position.x},${object.position.y}`]!, "land")).toBeNull();
  }
});

it.each([{ x: 9, kind: "tree" }, { x: 12, kind: "rock" }])("G-WILLOW $kind destruction costs one action, opens only its tile, rejects remote/repeated commands and survives replay/save/Resume", ({ x }) => {
  const session = act(ready(), { type: "start-encounter" });
  const definition = buildAdventureEncounter(context.pack, session.adventure!).definition;
  let state = session.combat!;
  for (let i = 0; i < 6 && state.turn.activeActorId !== HERO; i++) state = play(state, { type: "end-turn", actorId: state.turn.activeActorId, facing: state.actors[state.turn.activeActorId]!.facing }, definition);
  expect(state.turn.activeActorId).toBe(HERO);
  const object = Object.values(state.map.objects).find(o => o.position.x === x && o.position.y === 15)!;
  const input = { type: "use-action", actorId: HERO, action: destroy, target: { kind: "object", objectId: object.id } } as const;
  const remote = dispatchCombatCommand(state, command(state, input), definition.content);
  expect(remote.accepted).toBe(false); expect(remote.state).toEqual(state);
  state = play(state, { type: "use-action", actorId: HERO, action: { kind: "basic", id: "stride" }, target: { kind: "tile", position: { x, y: 16 } } }, definition);
  const before = state;
  state = play(state, input, definition);
  expect(state.turn.actionsRemaining).toBe(before.turn.actionsRemaining - 1);
  expect(state.rng).toEqual(before.rng);
  expect(state.map.objects[object.id]!.used).toBe(true);
  expect(movementCost(state.map.tiles[`${x},15`]!, "land")).toBe(5);
  expect(state.map.tiles["8,15"]).toEqual(before.map.tiles["8,15"]);
  expect(state.map.tiles[`${x},15`]!.traits.some(t => t.id.startsWith("forest-"))).toBe(true);
  const repeat = dispatchCombatCommand(state, command(state, input), definition.content);
  expect(repeat.accepted).toBe(false); expect(repeat.state).toEqual(state);
  expect(replayCombat(definition, createCombatReplay(state)).state).toEqual(state);
  const restored = restoreCampaignSave(saveRecord({ ...session, combat: state }), context).projection;
  const resumed = act(createResumedSessionCoreState({ sessionId: "forest-resume", playerId: "host", displayName: "Host" }, restored, context), { type: "resume-adventure" });
  expect(resumed.combat).toEqual(state);
});
