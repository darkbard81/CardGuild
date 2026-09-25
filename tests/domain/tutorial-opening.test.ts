import { expect, it } from "vitest";
import { createCombat, createCombatReplay, hashCombatState, replayCombat } from "../../src/game";
import { PRODUCTION_CONTENT } from "../../src/content/production-content";
import { deriveTacticalDeck } from "../../src/loadout";
import { laneCombat, play } from "../support/combat";

it("G-OPENING every creation Class and authored companion starts with exactly one weapon attack and one prepared card", () => {
  const pack = PRODUCTION_CONTENT.pack;
  const ids = [...Object.values(pack.creationPresets ?? {}).map(p => p.actorDefinitionId),
    ...Object.values(pack.companions ?? {}).map(c => c.actorDefinitionId)];
  expect(ids).toHaveLength(10);
  for (const id of ids) {
    const actor = pack.actorDefinitions[id]!;
    expect(actor.baseCardGrants, id).toEqual([]);
    expect(actor.starterLoadout.preparedCards, id).toHaveLength(1);
    expect(actor.loadoutProfile.preparedCardCapacity, id).toBeGreaterThan(1);
    const deck = deriveTacticalDeck(actor, actor.starterLoadout, pack.combatContent, "starter");
    expect(deck.totalCards, id).toBe(2);
    const weapon = deck.contributions.filter(c => c.source.kind === "equipment-trait");
    expect(weapon, id).toHaveLength(1);
    expect(weapon[0]!.count, id).toBe(1);
    const card = pack.combatContent.cards[weapon[0]!.cardDefinitionId]!;
    expect(pack.combatContent.actions[card.actionId]!.resolution.kind, id).toBe("strike");
  }
});

it("G-OPENING repeated lethal critical damage cannot defeat a protected hero; replay retains the protection", () => {
  const base = laneCombat();
  const actors = base.scenario.actors.map(a => ({ ...a, position: { x: a.id === "hero" ? 0 : 1, y: 0 },
    hp: 2, maxHp: 2, statProfile: { kind: "creature" as const, stats: {
      ac: 1, maxHp: 2, perception: a.id === "enemy" ? 100 : -100,
      saves: { fortitude: 0, reflex: 0, will: 0 }, skills: {},
      strike: { name: "Practice hit", attackModifier: 100, rangeFeet: 5,
        damage: { count: 1, sides: 6, modifier: 100, damageType: "bludgeoning" as const }, traits: [] },
    } } }));
  const definition = { ...base, scenario: { ...base.scenario, partyHpFloor: 1 as const, actors } };
  let state = createCombat(definition, 60).state;
  for (let turn = 0; turn < 20; turn++) {
    for (let attack = 0; attack < 3; attack++) state = play(state, {
      type: "use-action", actorId: "enemy", action: { kind: "basic", id: "strike" }, target: { kind: "actor", actorId: "hero" },
    }, definition);
    expect(state.actors.hero!.hp).toBe(1);
    expect(state.actors.hero!.defeated).toBe(false);
    expect(state.outcome).toBeNull();
    state = play(state, { type: "end-turn", actorId: "enemy", facing: "west" }, definition);
    state = play(state, { type: "end-turn", actorId: "hero", facing: "east" }, definition);
  }
  expect(hashCombatState(replayCombat(definition, createCombatReplay(state)).state)).toBe(hashCombatState(state));
  const ordinary = { ...base, scenario: { ...base.scenario, actors } };
  let unprotected = createCombat(ordinary, 60).state;
  unprotected = play(unprotected, { type: "use-action", actorId: "enemy", action: { kind: "basic", id: "strike" }, target: { kind: "actor", actorId: "hero" } }, ordinary);
  expect(unprotected.actors.hero!.hp).toBe(0);
  expect(unprotected.actors.hero!.defeated).toBe(true);
});
