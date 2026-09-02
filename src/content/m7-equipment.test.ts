import { describe, expect, it } from "vitest";

import { buildResolvedActionPlan } from "../game/action-plan";
import { resolveArmorClass, resolveStatisticModifier } from "../game/statistics";
import { equippedWeapon, resolveStrike } from "../game/offense";
import type { ActionTarget, ActorState, CombatState, EquipmentId } from "../game/types";
import { buildActorSetup } from "./compile-content";
import { M7_COMBAT_DEFINITION, M7_COMPILED_PACK, M7_CONTENT } from "./load-m7-content";

const CONTENT = M7_CONTENT;
const CONTEXT = { content: CONTENT };
const EQUIPMENT = M7_COMPILED_PACK.combatContent.equipment;

function hero(definitionId: string): ActorState {
  const definition = M7_COMPILED_PACK.actorDefinitions[definitionId];
  if (!definition) throw new Error(`Actor definition "${definitionId}" is missing.`);
  const actor = buildActorSetup(
    definition,
    {
      instanceId: definitionId,
      actorDefinitionId: definitionId,
      team: "heroes",
      position: { x: 1, y: 1 },
      facing: "east",
    },
    CONTENT,
  );
  return { ...actor, reactionAvailable: true, shieldRaised: false, defeated: false };
}

/** Aerin is the only scenario hero, so other builds are made by swapping her profile in. */
function wearing(base: ActorState, ...equipmentIds: readonly EquipmentId[]): ActorState {
  return { ...base, equipmentIds: [...equipmentIds] };
}

function asCharacter(base: ActorState, overrides: {
  readonly dex?: number;
  readonly str?: number;
  readonly martial?: "trained" | "expert";
  readonly heavy?: "untrained" | "trained" | "expert";
}): ActorState {
  if (base.statProfile.kind !== "character") throw new Error("Expected a Character.");
  const stats = base.statProfile.stats;
  return {
    ...base,
    statProfile: {
      kind: "character",
      stats: {
        ...stats,
        attributes: { ...stats.attributes, dex: overrides.dex ?? stats.attributes.dex, str: overrides.str ?? stats.attributes.str },
        offense: {
          ...stats.offense,
          weaponProficiencies: { ...stats.offense.weaponProficiencies, martial: overrides.martial ?? stats.offense.weaponProficiencies.martial },
        },
        defense: {
          ...stats.defense,
          armorProficiencies: { ...stats.defense.armorProficiencies, heavy: overrides.heavy ?? stats.defense.armorProficiencies.heavy },
        },
      },
    },
  };
}

const AERIN = hero("hero.aerin");
const ENEMY: ActorState = (() => {
  const actor = M7_COMBAT_DEFINITION.scenario.actors.find((entry) => entry.id === "goblin-skirmisher");
  if (!actor) throw new Error("Scenario enemy is missing.");
  return { ...actor, reactionAvailable: true, shieldRaised: false, defeated: false };
})();

describe("M7 equipment pool", () => {
  it("ships 20 to 30 definitions across all four slots", () => {
    const definitions = Object.values(EQUIPMENT);
    expect(definitions.length).toBeGreaterThanOrEqual(20);
    expect(definitions.length).toBeLessThanOrEqual(30);
    const bySlot = new Map<string, number>();
    for (const definition of definitions) bySlot.set(definition.slot, (bySlot.get(definition.slot) ?? 0) + 1);
    expect(bySlot.get("weapon") ?? 0).toBeGreaterThanOrEqual(8);
    expect(bySlot.get("armor") ?? 0).toBeGreaterThanOrEqual(4);
    expect(bySlot.get("shield") ?? 0).toBeGreaterThanOrEqual(3);
    expect(bySlot.get("feet") ?? 0).toBeGreaterThanOrEqual(4);
  });

  it("keeps every starter equipment reference #14 depends on", () => {
    // #14 owns the fixed starter kit; #17 must not move the ground under it.
    for (const definition of Object.values(M7_COMPILED_PACK.actorDefinitions)) {
      for (const equipmentId of Object.values(definition.starterLoadout.equipment)) {
        if (!equipmentId) continue;
        expect(`${definition.id}:${equipmentId}:${String(Boolean(EQUIPMENT[equipmentId]))}`)
          .toBe(`${definition.id}:${equipmentId}:true`);
      }
    }
  });

  it("has no two weapons sharing the same resolver-visible profile", () => {
    const seen = new Map<string, string>();
    for (const definition of Object.values(EQUIPMENT)) {
      const profile = definition.weaponProfile;
      if (!profile) continue;
      // Effective traits are the union the resolver reads, so two weapons differing only
      // by name collapse to the same key here.
      const traits = [...new Set([...definition.traits, ...profile.traits].map((trait) => trait.id))].sort();
      const key = [
        profile.category, profile.attackMode, String(profile.rangeFeet),
        `${String(profile.damage.count)}d${String(profile.damage.sides)}`, profile.damage.damageType,
        traits.join("+"),
      ].join("|");
      const existing = seen.get(key);
      expect(`${definition.id}:${existing ?? "unique"}`).toBe(`${definition.id}:unique`);
      seen.set(key, definition.id);
    }
  });

  it("only grants cards the M7 pack actually defines", () => {
    for (const definition of Object.values(EQUIPMENT)) {
      for (const trait of definition.traits) {
        for (const grant of CONTENT.traits[trait.id]?.cardGrants ?? []) {
          expect(`${definition.id}:${grant.cardDefinitionId}:${String(Boolean(CONTENT.cards[grant.cardDefinitionId]))}`)
            .toBe(`${definition.id}:${grant.cardDefinitionId}:true`);
        }
      }
    }
  });
});

describe("weapon trade-offs the resolver actually sees", () => {
  it("charges an advanced weapon its untrained proficiency", () => {
    const great = resolveStrike(wearing(AERIN, "greatsword"), CONTEXT);
    const executioner = resolveStrike(wearing(AERIN, "executioner-axe"), CONTEXT);
    // Same 1d12 die, but Aerin is expert with martial and untrained with advanced.
    expect(executioner.damage.sides).toBe(great.damage.sides);
    expect(executioner.attackModifier).toBeLessThan(great.attackModifier);
    expect(great.proficiencyRank).toBe("expert");
    expect(executioner.proficiencyRank).toBe("untrained");
  });

  it("charges a simple weapon the gap between simple and martial rank", () => {
    const halberd = resolveStrike(wearing(AERIN, "halberd"), CONTEXT);
    const spear = resolveStrike(wearing(AERIN, "boar-spear"), CONTEXT);
    expect(spear.rangeFeet).toBe(halberd.rangeFeet);
    expect(spear.attackModifier).toBeLessThan(halberd.attackModifier);
  });

  it("lets a finesse weapon pick the higher attribute for a DEX build", () => {
    const dexterous = asCharacter(AERIN, { dex: 6, str: 1 });
    const finesse = resolveStrike(wearing(dexterous, "flick-mace"), CONTEXT);
    const plain = resolveStrike(wearing(dexterous, "guardian-mace"), CONTEXT);
    expect(finesse.attackAttribute).toBe("dex");
    expect(plain.attackAttribute).toBe("str");
    expect(finesse.attackModifier).toBeGreaterThan(plain.attackModifier);
  });

  it("moves a Strike to Dexterity with finesse but leaves Trip on Athletics", () => {
    const dexterous = asCharacter(AERIN, { dex: 6, str: 1 });
    // A weapon's finesse trait is read by the #9 Strike resolver and nowhere else.
    expect(resolveStrike(wearing(dexterous, "flick-mace"), CONTEXT).attackAttribute).toBe("dex");
    // Trip names Athletics and authors no attributeOverride, so no weapon can move it to
    // Dexterity. PF2e agrees: finesse covers the attack roll, the trait keeps the skill.
    const trip = CONTENT.actions.trip;
    if (trip?.resolution.kind !== "check") throw new Error("Trip must be a check.");
    expect(trip.resolution.check.statistic).toEqual({ kind: "skill", skill: "athletics" });
    expect(resolveStatisticModifier(wearing(dexterous, "flick-mace"), { kind: "skill", id: "athletics" }, CONTEXT).value)
      .toBe(resolveStatisticModifier(wearing(dexterous), { kind: "skill", id: "athletics" }, CONTEXT).value);
  });

  it("keeps full Strength damage on a thrown weapon and halves it on a propulsive bow", () => {
    const thrown = resolveStrike(wearing(AERIN, "throwing-axes"), CONTEXT);
    const bow = resolveStrike(wearing(AERIN, "composite-shortbow"), CONTEXT);
    expect(thrown.attackAttribute).toBe("dex");
    expect(thrown.damage.flatModifier).toBeGreaterThan(bow.damage.flatModifier);
    expect(thrown.rangeFeet).toBeLessThan(bow.rangeFeet);
  });

  it("resolves the equipped weapon rather than the first equipment listed", () => {
    const equipped = equippedWeapon(wearing(AERIN, "scale-mail", "greatsword"), CONTEXT);
    expect(equipped?.id).toBe("greatsword");
  });
});

describe("armor and shield trade-offs", () => {
  it("makes brigandine better only when Dexterity is low", () => {
    const ac = (dex: number, armor: string): number =>
      resolveArmorClass(wearing(asCharacter(AERIN, { dex }), armor), CONTEXT).value;
    // +4/cap 0 against +3/cap 2: ahead at DEX 0, level at DEX 1, behind from DEX 2 on.
    expect(ac(0, "brigandine")).toBe(ac(0, "scale-mail") + 1);
    expect(ac(1, "brigandine")).toBe(ac(1, "scale-mail"));
    expect(ac(2, "brigandine")).toBe(ac(2, "scale-mail") - 1);
    expect(ac(4, "brigandine")).toBe(ac(4, "scale-mail") - 1);
  });

  it("loses to every playable hero's own starter armor, which is why brigandine is reserve", () => {
    // The scale-mail crossover above is real, but no hero sits on the winning side of it:
    // the one with DEX 0 is also the one with heavy proficiency. Offering it as a reward
    // would be offering a choice nobody can rationally take, so the reason is pinned here.
    for (const definition of Object.values(M7_COMPILED_PACK.actorDefinitions)) {
      if (!definition.traits.some((trait) => trait.id === "playable")) continue;
      const starter = definition.starterLoadout.equipment.armor;
      if (!starter) continue;
      const base = hero(definition.id);
      const own = resolveArmorClass(wearing(base, starter), CONTEXT).value;
      const swapped = resolveArmorClass(wearing(base, "brigandine"), CONTEXT).value;
      expect(`${definition.id}:${String(swapped < own)}`).toBe(`${definition.id}:true`);
    }
  });

  it("gives no Armor Class for armor the Character is untrained in", () => {
    const trained = asCharacter(AERIN, { heavy: "expert" });
    const untrained = asCharacter(AERIN, { heavy: "untrained" });
    expect(resolveArmorClass(wearing(trained, "half-plate"), CONTEXT).value)
      .toBeGreaterThan(resolveArmorClass(wearing(untrained, "half-plate"), CONTEXT).value);
  });

  it("trades scout leather's stealth bonus against its athletics penalty", () => {
    const scout = wearing(AERIN, "scout-leather");
    const plain = wearing(AERIN, "leather-armor");
    const read = (actor: ActorState, skill: "stealth" | "athletics"): number =>
      resolveStatisticModifier(actor, { kind: "skill", id: skill }, CONTEXT).value;
    expect(read(scout, "stealth")).toBe(read(plain, "stealth") + 1);
    expect(read(scout, "athletics")).toBe(read(plain, "athletics") - 1);
    expect(resolveArmorClass(scout, CONTEXT).value).toBe(resolveArmorClass(plain, CONTEXT).value);
  });

  it("pays for a tower shield's Armor Class with an attack penalty", () => {
    const tower = wearing(AERIN, "halberd", "tower-shield");
    const basic = wearing(AERIN, "halberd", "shield");
    expect(EQUIPMENT["tower-shield"]?.shieldBonus).toBeGreaterThan(EQUIPMENT.shield?.shieldBonus ?? 0);
    expect(resolveStrike(tower, CONTEXT).attackModifier).toBe(resolveStrike(basic, CONTEXT).attackModifier - 1);
  });

  it("trades a buckler's Armor Class for a Reflex bonus", () => {
    const buckler = wearing(AERIN, "buckler");
    const basic = wearing(AERIN, "shield");
    expect(EQUIPMENT.buckler?.shieldBonus).toBeLessThan(EQUIPMENT.shield?.shieldBonus ?? 0);
    expect(resolveStatisticModifier(buckler, { kind: "save", id: "reflex" }, CONTEXT).value)
      .toBe(resolveStatisticModifier(basic, { kind: "save", id: "reflex" }, CONTEXT).value + 1);
  });

  it("keeps a cursed talisman's penalty alongside its bonus", () => {
    const cursed = wearing(AERIN, "bloodied-talisman");
    const bare = wearing(AERIN);
    expect(resolveStatisticModifier(cursed, { kind: "save", id: "fortitude" }, CONTEXT).value)
      .toBe(resolveStatisticModifier(bare, { kind: "save", id: "fortitude" }, CONTEXT).value + 1);
    expect(resolveStatisticModifier(cursed, { kind: "save", id: "will" }, CONTEXT).value)
      .toBe(resolveStatisticModifier(bare, { kind: "save", id: "will" }, CONTEXT).value - 1);
  });

  it("raises the resolved Frostbite DC through a focus item's skill bonus", () => {
    const frostbite = CONTENT.actions.frostbite;
    if (!frostbite) throw new Error("Frostbite is missing.");
    const target: ActionTarget = { kind: "actor", actorId: ENEMY.id };
    const dcOf = (actor: ActorState): number => {
      const state = { actors: { [actor.id]: actor, [ENEMY.id]: ENEMY } } as unknown as CombatState;
      const plan = buildResolvedActionPlan(
        frostbite, actor, target, { kind: "card", id: "unused" }, state, CONTENT,
        { kind: "turn", attacksThisTurn: 0 },
      );
      if (plan?.resolution.kind !== "check") throw new Error("Frostbite must resolve as a check.");
      return plan.resolution.check.dc;
    };
    // Frostbite reads Arcana (INT) for its DC, so the item bonus has to arrive at the plan,
    // not merely at the raw statistic. This also catches the card being re-authored onto a
    // different DC source.
    expect(dcOf(wearing(AERIN, "hexers-focus"))).toBe(dcOf(wearing(AERIN)) + 1);
  });
});
