import { describe, expect, it } from "vitest";

import { M3_COMPILED_PACK } from "../content";
import {
  createStartingCollection,
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
    expect(createStartingCollection(party())).toEqual({
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
    const oneCopy = createStartingCollection(party());
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
    expect(validatePartyLoadout(transferred, createStartingCollection(party()), content)).toEqual({
      valid: true,
      issues: [],
    });
  });

  it("counts only prepared copies against card ownership and never consumes fixed grants", () => {
    const onePrepared = party({ equipment: actor.starterLoadout.equipment, preparedCards: ["card.fly"] });
    const oneCard: LoadoutCollection = {
      ...createStartingCollection(party()),
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
    expect(createStartingCollection(party()).cards).toEqual({});
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
              attackModifier: 7,
              rangeFeet: 5,
              damage: { count: 1, sides: 8, modifier: 3, damageType: "piercing" },
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
      { cardDefinitionId: "card.fly", count: 1, source: { kind: "prepared", memberId: "party.hero-1" } },
      { cardDefinitionId: "card.fly", count: 2, source: { kind: "equipment-trait", equipmentId: "boots-of-fly", traitId: "fly" } },
    ]);
  });

  it("uses the same rules for stat, weapon, context action, and deck preview", () => {
    const currentParty = party();
    const collection: LoadoutCollection = {
      ...createStartingCollection(currentParty),
      cards: { "card.fly": 1 },
    };
    const candidate: PartyMemberLoadout = {
      equipment: { weapon: "halberd" },
      preparedCards: ["card.fly"],
    };
    const preview = previewLoadoutChange(currentParty, collection, content, "party.hero-1", candidate);
    expect(preview.legal).toBe(true);
    expect(preview.before.statistics.reflex).toBe(16);
    expect(preview.after?.statistics.reflex).toBe(15);
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
    expect(snapshot.weapon.name).toBe("Halberd");
    expect(snapshot.contextActionIds).toEqual([]);
  });
});
