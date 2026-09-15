import { describe, expect, it } from "vitest";

import contentPackSchema from "../../content/schema/content-pack.schema.json";
import type { ActionDefinition, ConditionDefinition } from "../game/types";
import type { ContentPackSource } from "./content-types";
import { M7_COMPILED_PACK, M7_CONTENT_SOURCE } from "./load-m7-content";
import { isCardEligible } from "../game/capabilities";
import { createCombat, dispatchCombatCommand } from "../game/engine";
import { resolveActionSource } from "../game/queries";
import { getCombatDefinition } from "./compile-content";
import { createStartingCollection, validatePartyLoadout } from "../loadout";
import { validateContentPackStructure } from "./validate-content";
import { validateContentPackSemantics } from "./validate-semantics";

function source(): ContentPackSource {
  return structuredClone(M7_CONTENT_SOURCE);
}

/** Replaces one Action in a copy of the pack, leaving everything else authored as shipped. */
function withAction(id: string, mutate: (action: ActionDefinition) => ActionDefinition): ContentPackSource {
  const pack = source();
  const found = pack.actions.find((action) => action.id === id);
  if (!found) throw new Error(`Action "${id}" is missing.`);
  return { ...pack, actions: pack.actions.map((action) => (action.id === id ? mutate(action) : action)) };
}

function withCondition(id: string, mutate: (condition: ConditionDefinition) => ConditionDefinition): ContentPackSource {
  const pack = source();
  const found = pack.conditions.find((condition) => condition.id === id);
  if (!found) throw new Error(`Condition "${id}" is missing.`);
  return { ...pack, conditions: pack.conditions.map((entry) => (entry.id === id ? mutate(entry) : entry)) };
}

describe("production capability authoring contract", () => {
  const classCards: Readonly<Record<string, readonly string[]>> = {
    "card.vicious-swing": ["fighter"],
    "card.knockdown": ["fighter"],
    "card.intimidating-strike": ["fighter"],
    "card.combat-grab": ["fighter"],
    "card.dueling-parry": ["fighter"],
    "card.reactive-strike": ["fighter", "champion"],
    "card.lay-on-hands": ["champion"],
  };

  it("audits Class eligibility for every production Card, including reserves", () => {
    const content = M7_COMPILED_PACK.combatContent;
    for (const card of Object.values(content.cards)) {
      expect(card.traits.filter(trait => Object.hasOwn(content.classes, trait.id)).map(trait => trait.id).sort(), card.id)
        .toEqual([...(classCards[card.id] ?? [])].sort());
      for (const id of Object.keys(content.classes)) {
        expect(isCardEligible({ statProfile: { kind: "character" }, traits: [{ id }] }, card, content), `${card.id}/${id}`)
          .toBe(!classCards[card.id] || classCards[card.id]!.includes(id));
      }
    }
  });

  it("enforces production Class Cards in prepare and runtime even when owned", () => {
    const pack = M7_COMPILED_PACK;
    const content = pack.combatContent;
    const opened = createCombat(getCombatDefinition(pack, "encounter.ruined-gate"), 1).state;
    for (const definition of Object.values(pack.actorDefinitions).filter(actor => actor.traits.some(trait => trait.id === "playable"))) {
      for (const [cardId, classes] of Object.entries(classCards)) {
        const eligible = definition.traits.some(trait => classes.includes(trait.id));
        const member = { id: "hero", actorDefinitionId: definition.id, loadout: { ...definition.starterLoadout, preparedCards: [cardId] } };
        const party = { members: { hero: member } };
        const starting = createStartingCollection(party, pack);
        const collection = { ...starting, cards: { ...starting.cards, [cardId]: 1 } };
        expect(validatePartyLoadout(party, collection, pack).issues.map(issue => issue.code), `${definition.id}/${cardId}`)
          .toEqual(eligible ? [] : ["INELIGIBLE_CARD"]);
        const actor = { ...opened.actors.hero!, traits: definition.traits };
        const state = { ...opened, actors: { ...opened.actors, hero: actor },
          turn: { ...opened.turn, activeActorId: "hero", activeIndex: opened.turn.initiativeOrder.indexOf("hero") },
          cardZones: { ...opened.cardZones, hero: { ...opened.cardZones.hero!, hand: [{ id: "audit-card", definitionId: cardId, source: { kind: "prepared" as const, memberId: "hero" } }] } },
        };
        const action = { kind: "card" as const, id: "audit-card" };
        expect(resolveActionSource(state, actor, action, content) !== null).toBe(eligible);
        if (!eligible) {
          const result = dispatchCombatCommand(state, { type: "use-action", actorId: "hero", action, target: { kind: "none" }, id: "audit", sequence: state.sequence + 1 }, content);
          expect(result.accepted).toBe(false);
          expect(result.state).toBe(state);
        }
      }
    }
  });

  it("does not let a reward weapon bypass its granted Card's Class", () => {
    const pack = M7_COMPILED_PACK;
    for (const definition of Object.values(pack.actorDefinitions).filter(actor => actor.traits.some(trait => trait.id === "playable"))) {
      const party = { members: { hero: { id: "hero", actorDefinitionId: definition.id,
        loadout: { ...definition.starterLoadout, equipment: { ...definition.starterLoadout.equipment, weapon: "dueling-rapier" } },
      } } };
      const collection = createStartingCollection(party, pack);
      const result = validatePartyLoadout(party, { ...collection, equipment: { ...collection.equipment, "dueling-rapier": 1 } }, pack);
      expect(result.issues.map(issue => issue.code), definition.id)
        .toEqual(definition.traits.some(trait => trait.id === "fighter") ? [] : ["INELIGIBLE_CARD"]);
    }
  });

  it("keeps every reward useful to a starter and a usable choice in every offer for all starters", () => {
    const pack = M7_COMPILED_PACK;
    const starters = Object.values(pack.actorDefinitions).filter(actor => actor.traits.some(trait => trait.id === "playable"));
    for (const reward of pack.adventures["adventure.goblin-trouble"]!.rewards) {
      const usable = starters.map(definition => reward.choices.map(choice => {
        const member = { id: "hero", actorDefinitionId: definition.id, loadout: definition.starterLoadout };
        const party = { members: { hero: member } };
        const collection = createStartingCollection(party, pack);
        const loadout = choice.kind === "card"
          ? { ...member.loadout, preparedCards: [...member.loadout.preparedCards, choice.definitionId] }
          : { ...member.loadout, equipment: { ...member.loadout.equipment, [pack.combatContent.equipment[choice.definitionId]!.slot]: choice.definitionId } };
        const owned = choice.kind === "card"
          ? { ...collection, cards: { ...collection.cards, [choice.definitionId]: (collection.cards[choice.definitionId] ?? 0) + 1 } }
          : { ...collection, equipment: { ...collection.equipment, [choice.definitionId]: (collection.equipment[choice.definitionId] ?? 0) + 1 } };
        return validatePartyLoadout({ members: { hero: { ...member, loadout } } }, owned, pack).valid;
      }));
      starters.forEach((starter, index) => expect(usable[index]!.some(Boolean), `${reward.id}/${starter.id}`).toBe(true));
      reward.choices.forEach((choice, index) => expect(usable.some(row => row[index]), `${reward.id}/${choice.definitionId}`).toBe(true));
    }
  });

  it("accepts the shipped pack under both structural and semantic validation", () => {
    expect(validateContentPackStructure(M7_CONTENT_SOURCE, contentPackSchema)).toEqual([]);
    expect(validateContentPackSemantics(M7_CONTENT_SOURCE)).toEqual([]);
  });

  it("rejects a Condition value on a Condition that declares no policy", () => {
    const invalid = withAction("demoralize", (action) => {
      if (action.resolution.kind !== "check") throw new Error("Demoralize must be a check.");
      return {
        ...action,
        resolution: {
          ...action.resolution,
          outcomes: {
            ...action.resolution.outcomes,
            success: [{ kind: "apply-condition", owner: "target", condition: "prone", value: 2 }],
          },
        },
      };
    });
    expect(validateContentPackSemantics(invalid)).toContainEqual(expect.objectContaining({
      code: "CONDITION_VALUE_NOT_SUPPORTED",
      definitionId: "demoralize",
    }));
  });

  it("rejects a Condition value outside the policy range", () => {
    const invalid = withAction("demoralize", (action) => {
      if (action.resolution.kind !== "check") throw new Error("Demoralize must be a check.");
      return {
        ...action,
        resolution: {
          ...action.resolution,
          outcomes: {
            ...action.resolution.outcomes,
            success: [{ kind: "apply-condition", owner: "target", condition: "frightened", value: 9 }],
          },
        },
      };
    });
    expect(validateContentPackSemantics(invalid)).toContainEqual(expect.objectContaining({
      code: "CONDITION_VALUE_OUT_OF_RANGE",
      definitionId: "demoralize",
    }));
  });

  it("holds an Actor's initial Conditions to the same value invariant as an outcome effect", () => {
    const pack = source();
    const playable = pack.actors.find((entry) => entry.traits.some((trait) => trait.id === "playable"));
    if (!playable) throw new Error("A playable Actor is missing.");
    const withInitial = (condition: { id: string; sourceId: string; value?: number }): ContentPackSource => ({
      ...pack,
      actors: pack.actors.map((entry) =>
        entry.id === playable.id ? { ...entry, initialConditions: [condition] } : entry),
    });

    // In range: an Actor may legitimately start an encounter already frightened.
    expect(validateContentPackSemantics(withInitial({ id: "frightened", sourceId: "fixture", value: 2 }))).toEqual([]);

    // Out of range: without this the value would reach the modifier stack unscaled, and a
    // status penalty of -99 would poison every statistic until the Condition decayed away.
    expect(validateContentPackSemantics(withInitial({ id: "frightened", sourceId: "fixture", value: 99 })))
      .toContainEqual(expect.objectContaining({
        code: "CONDITION_VALUE_OUT_OF_RANGE",
        definitionId: playable.id,
      }));

    // The policy minimum is the "gone" value, so an Actor cannot start already at it.
    expect(validateContentPackSemantics(withInitial({ id: "frightened", sourceId: "fixture", value: 0 })))
      .toContainEqual(expect.objectContaining({
        code: "CONDITION_VALUE_OUT_OF_RANGE",
        definitionId: playable.id,
      }));

    // A Condition with no policy cannot carry a value on either authoring path.
    expect(validateContentPackSemantics(withInitial({ id: "prone", sourceId: "fixture", value: 2 })))
      .toContainEqual(expect.objectContaining({
        code: "CONDITION_VALUE_NOT_SUPPORTED",
        definitionId: playable.id,
      }));
  });

  it("rejects a value policy on a Condition that contributes no modifier", () => {
    const invalid = withCondition("prone", (condition) => ({
      ...condition,
      valuePolicy: { min: 0, max: 3, merge: "max", modifierScale: "multiply-by-value" },
    }));
    expect(validateContentPackSemantics(invalid)).toContainEqual(expect.objectContaining({
      code: "INVALID_CONDITION_VALUE_POLICY",
      definitionId: "prone",
    }));
  });

  it("rejects healing that neither rolls dice nor carries a flat amount", () => {
    const invalid = withAction("lay-on-hands", (action) => ({
      ...action,
      resolution: {
        kind: "direct",
        effects: [{ kind: "restore-hp", owner: "target", dice: { count: 0, sides: 6 }, flatModifier: 0 }],
      },
    }));
    expect(validateContentPackSemantics(invalid)).toContainEqual(expect.objectContaining({
      code: "INVALID_RESTORE_AMOUNT",
      definitionId: "lay-on-hands",
    }));
  });

  it("rejects a target-side effect on an Action that names no Actor", () => {
    const invalid = withAction("lay-on-hands", (action) => ({ ...action, targeting: "self" }));
    expect(validateContentPackSemantics(invalid)).toContainEqual(expect.objectContaining({
      code: "EFFECT_REQUIRES_TARGET",
      definitionId: "lay-on-hands",
    }));
  });

  it("rejects a MAP attack count on an Action without the attack trait", () => {
    const invalid = withAction("demoralize", (action) => ({ ...action, mapAttackCount: 2 }));
    expect(validateContentPackSemantics(invalid)).toContainEqual(expect.objectContaining({
      code: "MAP_COUNT_NOT_APPLICABLE",
      definitionId: "demoralize",
    }));
  });

  it("rejects a weapon-mode requirement on an Action with no weapon involved", () => {
    const invalid = withAction("heal", (action) => ({
      ...action,
      requirements: [{ kind: "weapon-mode", mode: "melee" }],
    }));
    expect(validateContentPackSemantics(invalid)).toContainEqual(expect.objectContaining({
      code: "REQUIREMENT_NOT_APPLICABLE",
      definitionId: "heal",
    }));
  });

  it("rejects unknown values in the widened enums", () => {
    const badTargeting = withAction("heal", (action) => ({ ...action, targeting: "everyone" as never }));
    expect(validateContentPackStructure(badTargeting, contentPackSchema).length).toBeGreaterThan(0);
    const badDamageType = withAction("harm", (action) => {
      if (action.resolution.kind !== "check") throw new Error("Harm must be a check.");
      return {
        ...action,
        resolution: {
          ...action.resolution,
          outcomes: {
            ...action.resolution.outcomes,
            failure: [{
              kind: "damage",
              owner: "target",
              dice: { count: 1, sides: 8 },
              flatModifier: 0,
              damageType: "necrotic" as never,
            }],
          },
        },
      };
    });
    expect(validateContentPackStructure(badDamageType, contentPackSchema).length).toBeGreaterThan(0);
  });

  it("keeps every authored damage type inside the Remaster set the runtime knows", () => {
    const known = new Set([
      "slashing", "piercing", "bludgeoning", "force", "acid", "cold", "electricity",
      "fire", "mental", "poison", "sonic", "spirit", "vitality", "void",
    ]);
    for (const action of M7_CONTENT_SOURCE.actions) {
      const effects = action.resolution.kind === "direct"
        ? action.resolution.effects
        : action.resolution.kind === "move"
          ? []
          : Object.values(action.resolution.outcomes).flat();
      for (const effect of effects) {
        if (effect.kind === "damage") expect(known.has(effect.damageType)).toBe(true);
      }
    }
  });

  it("authors no final attack modifier, damage attribute or spell DC on a card action", () => {
    for (const action of M7_CONTENT_SOURCE.actions) {
      const authored = JSON.stringify(action);
      expect(authored).not.toContain("attackModifier");
      expect(authored).not.toContain("spellDc");
      expect(authored).not.toContain("spellAttackModifier");
    }
  });
});
