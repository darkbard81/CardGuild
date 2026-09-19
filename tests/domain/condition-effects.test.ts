import { expect, it } from "vitest";
import { conditionEffects, conditionBlocksMovement } from "../../src/game/condition-effects";
import { resolveArmorClass } from "../../src/game/statistics";
import { battle, laneCombat } from "../support/combat";

it("G-CONDITION derived effects follow their parent and Off-guard never stacks with another cause", () => {
  const definition = laneCombat();
  const actor = battle(definition).actors.hero!;
  const context = { content: definition.content };
  const baseline = resolveArmorClass(actor, context).value;
  const grabbed = { id: "grabbed", sourceId: "enemy" };
  const prone = { id: "prone", sourceId: "trip" };
  expect(conditionEffects(grabbed).map(effect => effect.id)).toEqual(["immobilized", "off-guard"]);
  expect(conditionEffects(prone).map(effect => effect.id)).toEqual(["off-guard"]);
  for (const conditions of [[grabbed], [prone], [grabbed, prone]]) {
    const target = { ...actor, conditions };
    expect(conditionBlocksMovement(target)).toBe(true);
    expect(resolveArmorClass(target, context).value).toBe(baseline - 2);
    expect(resolveArmorClass(target, { ...context, modifiers: [{ selector: { kind: "ac" }, type: "circumstance", value: -2, label: "Rear", sourceId: "rear" }] }).value).toBe(baseline - 2);
  }
  expect(conditionBlocksMovement(actor)).toBe(false);
  expect(resolveArmorClass({ ...actor, conditions: [] }, context).value).toBe(baseline);
});

it("G-CONDITION attack preview, execution and replay use derived AC; movement queries reject immobilized actors", async () => {
  const { previewAction, dispatchCombatCommand, listLegalTargets, createCombatReplay, replayCombat } = await import("../../src/game");
  const { command } = await import("../support/combat");
  const base = laneCombat();
  const definition = { ...base, scenario: { ...base.scenario, actors: base.scenario.actors.map(actor => actor.id === "enemy"
    ? { ...actor, position: { x: 1, y: 0 }, conditions: [{ id: "grabbed", sourceId: "hero" }] } : actor) } };
  const state = battle(definition);
  const action = { kind: "basic", id: "strike" } as const;
  const target = { kind: "actor", actorId: "enemy" } as const;
  expect(previewAction(state, "hero", action, target, definition.content).check?.dc).toBe(14);
  const result = dispatchCombatCommand(state, command(state, { type: "use-action", actorId: "hero", action, target }), definition.content);
  expect(result.accepted).toBe(true);
  expect(replayCombat(definition, createCombatReplay(result.state)).state).toEqual(result.state);
  const blocked = { ...state, actors: { ...state.actors, hero: { ...state.actors.hero!, conditions: [{ id: "grabbed", sourceId: "enemy" }] } } };
  expect(listLegalTargets(blocked, "hero", { kind: "basic", id: "stride" }, definition.content)).toHaveLength(0);
});
