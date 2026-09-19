import { expect, it } from "vitest";
import { canInspectActor, createCombatReplay, dispatchCombatCommand, listLegalTargets, previewAction, recallKnowledgeSkill, replayCombat, type CombatDefinition } from "../../src/game";
import { battle, command, laneCombat } from "../support/combat";

const source = { kind: "basic", id: "recall-knowledge" } as const;
function fixture(modifier: number): CombatDefinition {
  const base = laneCombat({ ally: true });
  return { ...base, content: { ...base.content, actions: { ...base.content.actions,
    "recall-knowledge": { id: "recall-knowledge", name: "Recall Knowledge", description: "Identify", timing: { kind: "turn", actions: 1 }, traits: [{ id: "concentrate" }], targeting: "enemy", range: { kind: "feet", value: 120 }, resolution: { kind: "recall-knowledge" } },
  } }, scenario: { ...base.scenario, actors: base.scenario.actors.map(actor => ({ ...actor, statProfile: { kind: "creature", stats: { ac: 16, maxHp: 30, strike: { name: "Strike", attackModifier: 8, rangeFeet: 5, damage: { count: 1, sides: 6, modifier: 3, damageType: "piercing" }, traits: [] }, perception: actor.id === "hero" ? 100 : -100, level: 3, saves: { fortitude: 4, reflex: 3, will: 2 }, skills: actor.id === "hero" ? { medicine: modifier } : { athletics: 7, medicine: 10 } } } })) } };
}

it.each([80, -80])("G-KNOWLEDGE strongest target skill, level DC, cost, shared unlock and retry lock (%i)", modifier => {
  const definition = fixture(modifier), state = battle(definition);
  expect(canInspectActor(state, "enemy")).toBe(false);
  expect(recallKnowledgeSkill(state.actors.enemy!, definition.content)).toBe("medicine");
  const target = { kind: "actor", actorId: "enemy" } as const;
  const preview = previewAction(state, "hero", source, target, definition.content);
  expect(preview.check).toMatchObject({ modifier, dc: 18 });
  const result = dispatchCombatCommand(state, command(state, { type: "use-action", actorId: "hero", action: source, target }), definition.content);
  expect(result.accepted).toBe(true);
  expect(result.state.turn.actionsRemaining).toBe(2);
  expect(result.state.knowledge).toEqual([{ actorId: "hero", targetId: "enemy", success: modifier > 0 }]);
  expect(canInspectActor(result.state, "enemy")).toBe(modifier > 0);
  expect(listLegalTargets(result.state, "hero", source, definition.content)).not.toContainEqual(expect.objectContaining({ actorId: "enemy" }));
  const refused = dispatchCombatCommand(result.state, command(result.state, { type: "use-action", actorId: "hero", action: source, target }), definition.content);
  expect(refused.accepted).toBe(false);
  expect(refused.state).toEqual(result.state);
  expect(replayCombat(definition, createCombatReplay(result.state)).state).toEqual(result.state);
  expect(canInspectActor(JSON.parse(JSON.stringify(result.state)), "enemy")).toBe(modifier > 0);
  expect(battle(definition).knowledge).toBeUndefined();
});
