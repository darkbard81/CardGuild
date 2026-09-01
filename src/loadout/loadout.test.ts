import { describe, expect, it } from "vitest";

import {
  M3_COMPILED_PACK,
  M3_CONTENT_IDENTITY,
  M3_ROAD_AMBUSH_ID,
  M6_COMBAT_DEFINITION,
  M6_COMPILED_PACK,
} from "../content";
import { createCombat, resolveArmorClass, resolveStrike } from "../game";
import {
  createStartingCollection,
  deriveActorSetup,
  deriveLoadoutSnapshot,
  deriveTacticalDeck,
  previewLoadoutChange,
  validatePartyLoadout,
} from "./loadout";
import type { LoadoutCollection, LoadoutContent, LoadoutParty, PartyMemberLoadout } from "./types";

const actor = M3_COMPILED_PACK.actorDefinitions["hero.aerin"] as NonNullable<
  (typeof M3_COMPILED_PACK.actorDefinitions)["hero.aerin"]
>;
const content: LoadoutContent = M3_COMPILED_PACK;

function member(loadout: PartyMemberLoadout = actor.starterLoadout, id = "party.hero-1") {
  return { id, actorDefinitionId: actor.id, loadout };
}

function party(loadout: PartyMemberLoadout = actor.starterLoadout): LoadoutParty {
  return { members: { "party.hero-1": member(loadout) } };
}

describe("loadout ownership and derivation", () => {
  it("turns transferable starter loadout copies into collection ownership", () => {
    expect(createStartingCollection(party(), content)).toEqual({
      equipment: { halberd: 1, shield: 1, "boots-of-fly": 1 },
      cards: {},
    });
  });

  it("rejects cross-party copy overuse, slot mismatch, and prepared capacity without mutation", () => {
    const twoMembers: LoadoutParty = {
      members: {
        one: member(actor.starterLoadout, "one"),
        two: member(actor.starterLoadout, "two"),
      },
    };
    const oneCopy = createStartingCollection(party(), content);
    expect(validatePartyLoadout(twoMembers, oneCopy, content).issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["EQUIPMENT_COPIES_EXCEEDED"]),
    );

    const invalid = party({
      equipment: { feet: "halberd" },
      preparedCards: ["card.fly", "card.fly", "card.fly"],
    });
    const collection: LoadoutCollection = {
      equipment: { halberd: 1 },
      cards: { "card.fly": 3 },
    };
    expect(validatePartyLoadout(invalid, collection, content).issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["SLOT_MISMATCH", "PREPARED_CAPACITY_EXCEEDED"]),
    );
  });

  it("releases owned equipment for another party member after unequip", () => {
    const empty: PartyMemberLoadout = { equipment: {}, preparedCards: [] };
    const transferred: LoadoutParty = {
      members: {
        one: member(empty, "one"),
        two: member(actor.starterLoadout, "two"),
      },
    };
    expect(validatePartyLoadout(transferred, createStartingCollection(party(), content), content)).toEqual({
      valid: true,
      issues: [],
    });
  });

  it("counts only prepared copies against card ownership and never consumes fixed grants", () => {
    const onePrepared = party({ equipment: actor.starterLoadout.equipment, preparedCards: ["card.fly"] });
    const oneCard: LoadoutCollection = {
      ...createStartingCollection(party(), content),
      cards: { "card.fly": 1 },
    };
    expect(validatePartyLoadout(onePrepared, oneCard, content)).toEqual({ valid: true, issues: [] });

    const duplicate = party({
      equipment: actor.starterLoadout.equipment,
      preparedCards: ["card.fly", "card.fly"],
    });
    expect(validatePartyLoadout(duplicate, oneCard, content).issues.map((issue) => issue.code)).toContain(
      "CARD_COPIES_EXCEEDED",
    );
    expect(createStartingCollection(party(), content).cards).toEqual({});
    expect(deriveTacticalDeck(actor, actor.starterLoadout, content.combatContent, "party.hero-1").contributions)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ source: { kind: "base", sourceId: "focus.spirit-beacon" } }),
        expect.objectContaining({ source: { kind: "base", sourceId: "feat.reactive-strike" } }),
      ]));
  });

  it("permits a same-slot replacement fixture and retains deterministic source-separated contributions", () => {
    const fixtureContent: LoadoutContent = {
      ...content,
      combatContent: {
        ...content.combatContent,
        equipment: {
          ...content.combatContent.equipment,
          "training-spear": {
            id: "training-spear",
            name: "Training Spear",
            slot: "weapon",
            traits: [{ id: "weapon" }],
            statModifiers: [],
            weaponProfile: {
              name: "Training Spear",
              category: "simple",
              attackMode: "melee",
              rangeFeet: 5,
              damage: { count: 1, sides: 8, damageType: "piercing" },
              traits: [],
            },
          },
        },
      },
    };
    const replacement = party({
      equipment: { ...actor.starterLoadout.equipment, weapon: "training-spear" },
      preparedCards: ["card.fly"],
    });
    const collection: LoadoutCollection = {
      equipment: { "training-spear": 1, shield: 1, "boots-of-fly": 1 },
      cards: { "card.fly": 1 },
    };
    expect(validatePartyLoadout(replacement, collection, fixtureContent)).toEqual({ valid: true, issues: [] });

    const deck = deriveTacticalDeck(actor, replacement.members["party.hero-1"]?.loadout as PartyMemberLoadout, fixtureContent.combatContent, "party.hero-1");
    expect(deck.totalCards).toBe(6);
    expect(deck.contributions.filter((entry) => entry.cardDefinitionId === "card.fly")).toEqual([
      { cardDefinitionId: "card.fly", count: 2, source: { kind: "equipment-trait", equipmentId: "boots-of-fly", traitId: "fly" } },
      { cardDefinitionId: "card.fly", count: 1, source: { kind: "prepared", memberId: "party.hero-1" } },
    ]);
  });

  it("canonicalizes a prepared-card multiset before setup fingerprinting and seeded card allocation", () => {
    const placement = {
      instanceId: "party.hero-1",
      actorDefinitionId: actor.id,
      team: "heroes" as const,
      position: { x: 0, y: 0 },
      facing: "north" as const,
      partyMemberId: "party.hero-1",
    };
    const source = M3_COMPILED_PACK.scenarioSources[M3_ROAD_AMBUSH_ID];
    expect(source).toBeDefined();
    const map = M3_COMPILED_PACK.scenarios[M3_ROAD_AMBUSH_ID]?.map;
    expect(map).toBeDefined();
    const loadouts = [
      { equipment: actor.starterLoadout.equipment, preparedCards: ["card.trip", "card.fly"] },
      { equipment: actor.starterLoadout.equipment, preparedCards: ["card.fly", "card.trip"] },
    ] as const;
    const definitions = loadouts.map((loadout) => ({
      content: content.combatContent,
      contentIdentity: M3_CONTENT_IDENTITY,
      scenario: {
        id: source?.id ?? M3_ROAD_AMBUSH_ID,
        name: source?.name ?? "Road Ambush",
        objective: source?.objective ?? { kind: "defeat-all-enemies" as const, description: "Test" },
        actors: [deriveActorSetup(actor, placement, loadout, content.combatContent, placement.partyMemberId)],
        map: map as NonNullable<typeof map>,
      },
    }));

    const first = createCombat(definitions[0] as NonNullable<(typeof definitions)[number]>, 77).state;
    const second = createCombat(definitions[1] as NonNullable<(typeof definitions)[number]>, 77).state;

    expect(first.actors[placement.instanceId]?.deckContributions).toEqual(
      second.actors[placement.instanceId]?.deckContributions,
    );
    expect(first.setupFingerprint).toBe(second.setupFingerprint);
    expect(first.cardZones).toEqual(second.cardZones);
  });

  it("uses the same rules for stat, weapon, context action, and deck preview", () => {
    const currentParty = party();
    const collection: LoadoutCollection = {
      ...createStartingCollection(currentParty, content),
      cards: { "card.fly": 1 },
    };
    const candidate: PartyMemberLoadout = {
      equipment: { weapon: "halberd" },
      preparedCards: ["card.fly"],
    };
    const preview = previewLoadoutChange(currentParty, collection, content, "party.hero-1", candidate);
    expect(preview.legal).toBe(true);
    expect(preview.before.statistics.reflex.dc).toBe(16);
    expect(preview.after?.statistics.reflex.dc).toBe(15);
    expect(preview.removedContextActionIds).toEqual(["raise-shield"]);
    expect(preview.after?.deck.totalCards).toBe(7);
    expect(preview.addedCards).toContainEqual({
      cardDefinitionId: "card.fly",
      count: 1,
      source: { kind: "prepared", memberId: "party.hero-1" },
    });
    expect(preview.removedCards).toContainEqual({
      cardDefinitionId: "card.fly",
      count: 2,
      source: { kind: "equipment-trait", equipmentId: "boots-of-fly", traitId: "fly" },
    });

    const snapshot = deriveLoadoutSnapshot(actor, candidate, content.combatContent, "party.hero-1");
    expect(snapshot.strike.weaponName).toBe("Halberd");
    expect(snapshot.contextActionIds).toEqual([]);
  });
});

describe("resolved Strike and Class DC in the Loadout preview", () => {
  const pack: LoadoutContent = M6_COMPILED_PACK;
  const placement = {
    instanceId: "hero.probe",
    team: "heroes" as const,
    position: { x: 0, y: 0 },
    facing: "north" as const,
  };

  function hero(id: string) {
    return M6_COMPILED_PACK.actorDefinitions[id] as NonNullable<
      (typeof M6_COMPILED_PACK.actorDefinitions)[string]
    >;
  }

  /** Puts the member into a real encounter and reads the Strike combat would roll. */
  function combatStrike(actorId: string, loadout: PartyMemberLoadout) {
    const actor = hero(actorId);
    const setup = deriveActorSetup(actor, { ...placement, actorDefinitionId: actor.id }, loadout, pack.combatContent, "party.hero-1");
    const state = createCombat(
      { ...M6_COMBAT_DEFINITION, scenario: { ...M6_COMBAT_DEFINITION.scenario, actors: [setup, ...M6_COMBAT_DEFINITION.scenario.actors] } },
      7,
    ).state;
    const combatActor = state.actors["hero.probe"] as NonNullable<(typeof state.actors)["hero.probe"]>;
    return resolveStrike(combatActor, { content: pack.combatContent });
  }

  it("gives every starter hero a valid derived Strike and Class DC", () => {
    const summary = ["hero.aerin", "hero.lyra", "hero.brom"].map((id) => {
      const actor = hero(id);
      const snapshot = deriveLoadoutSnapshot(actor, actor.starterLoadout, pack.combatContent, "party.hero-1");
      return [
        snapshot.strike.weaponName,
        snapshot.strike.attackModifier,
        snapshot.strike.damage.flatModifier,
        snapshot.statistics.classDc,
      ];
    });
    expect(summary).toEqual([
      ["Halberd", 8, 3, 16],
      ["Light Blade", 7, 2, 17],
      ["Guardian Mace", 6, 3, 16],
    ]);
  });

  it("owns each hero's starter weapon through the collection instead of a fallback", () => {
    const party: LoadoutParty = {
      members: Object.fromEntries(["hero.aerin", "hero.lyra", "hero.brom"].map((id, index) => [
        `party.hero-${index + 1}`,
        { id: `party.hero-${index + 1}`, actorDefinitionId: id, loadout: hero(id).starterLoadout },
      ])),
    };
    const collection = createStartingCollection(party, pack);
    expect(collection.equipment).toMatchObject({ halberd: 1, "light-blade": 1, "guardian-mace": 1 });
  });

  it("previews a weapon swap with the Strike the next encounter actually resolves", () => {
    const lyra = hero("hero.lyra");
    const party: LoadoutParty = {
      members: { "party.hero-1": { id: "party.hero-1", actorDefinitionId: lyra.id, loadout: lyra.starterLoadout } },
    };
    const collection = { ...createStartingCollection(party, pack), equipment: { ...createStartingCollection(party, pack).equipment, "composite-shortbow": 1 } };
    const ranged: PartyMemberLoadout = {
      equipment: { ...lyra.starterLoadout.equipment, weapon: "composite-shortbow" },
      preparedCards: [...lyra.starterLoadout.preparedCards],
    };
    const preview = previewLoadoutChange(party, collection, pack, "party.hero-1", ranged);

    expect(preview.legal).toBe(true);
    // Finesse melee: DEX 4 + trained 3, STR 2 to damage. Ranged propulsive: DEX 4 + trained 3, half STR.
    expect([preview.before.strike.attackModifier, preview.before.strike.damage.flatModifier, preview.before.strike.rangeFeet]).toEqual([7, 2, 5]);
    expect([preview.after?.strike.attackModifier, preview.after?.strike.damage.flatModifier, preview.after?.strike.rangeFeet]).toEqual([7, 1, 60]);
    expect(preview.after?.strike.attackMode).toBe("ranged");

    // Preview and encounter read one resolver, so the whole resolved Strike matches.
    expect(combatStrike("hero.lyra", lyra.starterLoadout)).toEqual(preview.before.strike);
    expect(combatStrike("hero.lyra", ranged)).toEqual(preview.after?.strike);
  });

  it("carries the weapon choice into the encounter setup fingerprint", () => {
    const lyra = hero("hero.lyra");
    const unarmed: PartyMemberLoadout = {
      equipment: { ...lyra.starterLoadout.equipment, weapon: undefined },
      preparedCards: [...lyra.starterLoadout.preparedCards],
    };
    const fingerprints = [lyra.starterLoadout, unarmed].map((loadout) => {
      const setup = deriveActorSetup(lyra, { ...placement, actorDefinitionId: lyra.id }, loadout, pack.combatContent, "party.hero-1");
      return createCombat(
        { ...M6_COMBAT_DEFINITION, scenario: { ...M6_COMBAT_DEFINITION.scenario, actors: [setup, ...M6_COMBAT_DEFINITION.scenario.actors] } },
        7,
      ).state.setupFingerprint;
    });
    expect(fingerprints[0]).not.toBe(fingerprints[1]);
  });

  it("falls back to the authored unarmed Strike when the weapon slot is emptied", () => {
    const brom = hero("hero.brom");
    const unarmed: PartyMemberLoadout = {
      equipment: { ...brom.starterLoadout.equipment, weapon: undefined },
      preparedCards: [...brom.starterLoadout.preparedCards],
    };
    const snapshot = deriveLoadoutSnapshot(brom, unarmed, pack.combatContent, "party.hero-1");
    expect([snapshot.strike.weaponName, snapshot.strike.weaponCategory, snapshot.strike.attackModifier]).toEqual(["Fist", "unarmed", 6]);
    expect(snapshot.strike.traits).toContain("agile");
    expect(combatStrike("hero.brom", unarmed).weaponName).toBe("Fist");
  });
});

describe("armor loadout and derived defenses", () => {
  const armoredContent: LoadoutContent = M6_COMPILED_PACK;
  const aerin = M6_COMPILED_PACK.actorDefinitions["hero.aerin"] as NonNullable<
    (typeof M6_COMPILED_PACK.actorDefinitions)["hero.aerin"]
  >;

  function armoredParty(loadout: PartyMemberLoadout = aerin.starterLoadout): LoadoutParty {
    return { members: { "party.hero-1": { id: "party.hero-1", actorDefinitionId: aerin.id, loadout } } };
  }

  it("owns starter armor and keeps the armor slot in deterministic equipment order", () => {
    expect(createStartingCollection(armoredParty(), armoredContent).equipment).toEqual({
      halberd: 1,
      "scale-mail": 1,
      shield: 1,
      "boots-of-fly": 1,
    });
    expect(deriveLoadoutSnapshot(aerin, aerin.starterLoadout, armoredContent.combatContent, "party.hero-1").equipmentIds)
      .toEqual(["halberd", "scale-mail", "shield", "boots-of-fly"]);
  });

  it("rejects non-armor equipment in the armor slot", () => {
    const invalid = armoredParty({ equipment: { armor: "halberd" }, preparedCards: [] });
    expect(validatePartyLoadout(invalid, { equipment: { halberd: 1 }, cards: {} }, armoredContent).issues)
      .toContainEqual(expect.objectContaining({ code: "SLOT_MISMATCH", slot: "armor", definitionId: "halberd" }));
  });

  it("previews an armor swap with the AC the next encounter actually resolves", () => {
    const currentParty = armoredParty();
    const collection = createStartingCollection(currentParty, armoredContent);
    const unarmored: PartyMemberLoadout = {
      equipment: { ...aerin.starterLoadout.equipment, armor: undefined },
      preparedCards: [...aerin.starterLoadout.preparedCards],
    };
    const preview = previewLoadoutChange(currentParty, collection, armoredContent, "party.hero-1", unarmored);

    expect(preview.legal).toBe(true);
    expect(preview.before.statistics.ac).toBe(18);
    expect(preview.after?.statistics.ac).toBe(15);
    expect(preview.before.armor).toEqual({
      id: "scale-mail",
      name: "Scale Mail",
      category: "medium",
      acItemBonus: 3,
      dexCap: 2,
    });
    expect(preview.after?.armor.category).toBe("unarmored");

    const placement = { instanceId: "hero.probe", actorDefinitionId: aerin.id, team: "heroes" as const, position: { x: 0, y: 0 }, facing: "north" as const };
    const fingerprints: string[] = [];
    for (const [loadout, expected] of [[aerin.starterLoadout, 18], [unarmored, 15]] as const) {
      const setup = deriveActorSetup(aerin, placement, loadout, armoredContent.combatContent, "party.hero-1");
      const state = createCombat(
        { ...M6_COMBAT_DEFINITION, scenario: { ...M6_COMBAT_DEFINITION.scenario, actors: [setup, ...M6_COMBAT_DEFINITION.scenario.actors] } },
        7,
      ).state;
      const combatActor = state.actors["hero.probe"] as NonNullable<typeof state.actors["hero.probe"]>;
      expect(resolveArmorClass(combatActor, { content: armoredContent.combatContent }).value).toBe(expected);
      fingerprints.push(state.setupFingerprint);
    }
    expect(fingerprints[0]).not.toBe(fingerprints[1]);
  });

  it("derives max HP from the character profile and starts the encounter at full health", () => {
    const setup = deriveActorSetup(
      aerin,
      { instanceId: "hero.probe", actorDefinitionId: aerin.id, team: "heroes", position: { x: 0, y: 0 }, facing: "north" },
      aerin.starterLoadout,
      armoredContent.combatContent,
      "party.hero-1",
    );

    expect(setup.maxHp).toBe(21);
    expect(setup.hp).toBe(setup.maxHp);
    expect(deriveLoadoutSnapshot(aerin, aerin.starterLoadout, armoredContent.combatContent, "party.hero-1").statistics.maxHp)
      .toBe(21);
  });
});
