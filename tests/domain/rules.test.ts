import { expect, it } from "vitest";
import {
  damageTotal, resolveArmorClass, resolveMaxHp, resolveStatisticModifier, resolveStrike,
  type ActorState, type CharacterStatProfile, type StatisticContextModifier,
} from "../../src/game";
import { resolveDegree } from "../../src/game/checks";
import { battle, laneCombat } from "../support/combat";
import { context } from "../support/session";

it.each([
  [9, 0, 10, "failure"], [10, 0, 10, "success"], [19, 0, 10, "success"],
  [10, 0, 20, "critical-failure"], [10, 0, 0, "critical-success"],
  [1, 20, 10, "success"], [20, -20, 10, "failure"],
] as const)("G-RULE roll %i + %i against DC %i produces %s", (roll, modifier, dc, degree) => {
  expect(resolveDegree(roll, modifier, dc).degree).toBe(degree);
});

it("G-RULE same-type bonuses and penalties use strongest; different types and untyped penalties stack", () => {
  const values = [
    ["status", 1], ["status", 3], ["status", -1], ["status", -2],
    ["circumstance", 2], ["untyped", -1], ["untyped", -1],
  ] as const;
  const modifiers: StatisticContextModifier[] = values.map(([type, value], i) => ({
    type, value, selector: { kind: "save", id: "reflex" }, sourceId: `effect-${i}`, label: `Effect ${i}`,
  }));
  const definition = laneCombat();
  const actor = battle(definition).actors.hero!;
  // Fixed Reflex 3 + status (3 - 2) + circumstance 2 - two untyped penalties = 4.
  expect(resolveStatisticModifier(actor, { kind: "save", id: "reflex" }, { content: definition.content, modifiers }).value).toBe(4);
  expect(resolveStatisticModifier(actor, { kind: "save", id: "will" }, { content: definition.content, modifiers }).value).toBe(2);
});

it("G-RULE character level/proficiency, armor dex cap, weapon attribute and MAP share the declared rules", () => {
  const source = context.pack.actorDefinitions["hero.aerin"]!;
  if (source.statProfile.kind !== "character") throw new Error("Aerin is a Character");
  const stats: CharacterStatProfile = {
    ...source.statProfile.stats, level: 3,
    attributes: { str: 4, dex: 5, con: 2, int: 0, wis: 1, cha: 0 },
  };
  const actor: ActorState = {
    ...battle().actors.hero!, statProfile: { kind: "character", stats },
    equipmentIds: ["scale-mail", "halberd"],
  };
  const content = context.pack.combatContent;
  // Human HP 8 + level 3 × (Fighter HP 10 + CON 2).
  expect(resolveMaxHp(actor.statProfile)).toBe(44);
  // AC 10 + trained (3 + 2) + armor 3 + capped DEX 2.
  expect(resolveArmorClass(actor, { content }).value).toBe(20);
  // Expert weapon proficiency (3 + 4) + STR 4; second/third attacks -5/-10.
  expect([0, 1, 2, 3].map(attacksThisTurn => resolveStrike(actor, { content }, { attacksThisTurn }).attackModifier)).toEqual([11, 6, 1, 1]);
  const strike = resolveStrike(actor, { content });
  expect(strike.damage.flatModifier).toBe(4);
  // Damage is doubled after the flat term; even a severe penalty cannot heal a target.
  expect(damageTotal(5, 4, 2)).toBe(18);
  expect(damageTotal(1, -8, 1)).toBe(1);
});
