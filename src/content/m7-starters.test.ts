import { describe, expect, it } from "vitest";

import { createCombat, dispatchCombatCommand } from "../game/engine";
import { listLegalActions } from "../game/queries";
import { SKILL_IDS, ATTRIBUTE_IDS, SAVE_IDS } from "../game/statistics";
import type { ActorDefinitionId } from "../game/types";
import {
  createStartingCollection,
  deriveLoadoutSnapshot,
  validatePartyLoadout,
  type LoadoutParty,
} from "../loadout";
import { buildActorSetup, getCombatDefinition } from "./compile-content";
import { M7_COMPILED_PACK, M7_CONTENT, M7_RUINED_GATE_ID } from "./load-m7-content";

const PACK = M7_COMPILED_PACK;
const CONTENT = M7_CONTENT;

const STARTERS = Object.values(PACK.actorDefinitions)
  .filter((actor) => actor.traits.some((trait) => trait.id === "playable"))
  .sort((left, right) => left.id.localeCompare(right.id));

/** A party of the given starters, each holding its own authored starting kit. */
function party(actorDefinitionIds: readonly ActorDefinitionId[]): LoadoutParty {
  return {
    members: Object.fromEntries(actorDefinitionIds.map((actorDefinitionId, index) => {
      const definition = PACK.actorDefinitions[actorDefinitionId];
      if (!definition) throw new Error(`Actor definition "${actorDefinitionId}" is missing.`);
      const id = `party.hero-${String(index + 1)}`;
      return [id, { id, actorDefinitionId, loadout: definition.starterLoadout }];
    })),
  };
}

function compositions(): readonly (readonly ActorDefinitionId[])[] {
  const ids = STARTERS.map((actor) => actor.id);
  const result: ActorDefinitionId[][] = [];
  for (const id of ids) result.push([id]);
  for (const first of ids) for (const second of ids) {
    if (first !== second) result.push([first, second]);
  }
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      for (let k = j + 1; k < ids.length; k += 1) {
        result.push([ids[i] as string, ids[j] as string, ids[k] as string]);
      }
    }
  }
  return result;
}

describe("M7 starter roster", () => {
  it("offers four selectable Characters", () => {
    expect(STARTERS).toHaveLength(4);
    for (const actor of STARTERS) expect(actor.statProfile.kind).toBe("character");
  });

  it("authors every Attribute, Perception, Save and Skill on each Character", () => {
    for (const actor of STARTERS) {
      if (actor.statProfile.kind !== "character") throw new Error("Expected a Character.");
      const stats = actor.statProfile.stats;
      for (const attribute of ATTRIBUTE_IDS) {
        expect(`${actor.id}:${attribute}`).toBe(`${actor.id}:${stats.attributes[attribute] === undefined ? "missing" : attribute}`);
      }
      for (const save of SAVE_IDS) expect(stats.saves[save]).toBeDefined();
      for (const skill of SKILL_IDS) {
        expect(`${actor.id}:${skill}:${String(stats.skills[skill] !== undefined)}`).toBe(`${actor.id}:${skill}:true`);
      }
      expect(stats.perception).toBeDefined();
    }
  });

  it("never authors a derived Armor Class, HP, Strike or DC on a Character", () => {
    for (const actor of STARTERS) {
      const authored = JSON.stringify(actor.statProfile);
      for (const forbidden of ["\"ac\"", "\"maxHp\"", "\"hp\"", "\"baseAc\"", "\"attackModifier\"", "\"classDc\""]) {
        expect(`${actor.id}:${forbidden}:${String(authored.includes(forbidden))}`).toBe(`${actor.id}:${forbidden}:false`);
      }
    }
  });

  it("references only equipment and cards the M7 pack defines", () => {
    for (const actor of STARTERS) {
      for (const equipmentId of Object.values(actor.starterLoadout.equipment)) {
        if (!equipmentId) continue;
        expect(`${actor.id}:${equipmentId}`).toBe(`${actor.id}:${CONTENT.equipment[equipmentId] ? equipmentId : "missing"}`);
      }
      const cardIds = [
        ...actor.starterLoadout.preparedCards,
        ...actor.baseCardGrants.map((grant) => grant.cardDefinitionId),
      ];
      for (const cardId of cardIds) {
        expect(`${actor.id}:${cardId}`).toBe(`${actor.id}:${CONTENT.cards[cardId] ? cardId : "missing"}`);
      }
    }
  });

  it("keeps every starting loadout inside its own prepared-card capacity, with room to grow", () => {
    for (const actor of STARTERS) {
      const used = actor.starterLoadout.preparedCards.length;
      const capacity = actor.loadoutProfile.preparedCardCapacity;
      expect(`${actor.id}:${String(used <= capacity)}`).toBe(`${actor.id}:true`);
      // #19 hands out cards later, so no starter may begin with its capacity full.
      expect(`${actor.id}:free=${String(capacity - used)}`).toBe(`${actor.id}:free=${String(Math.max(1, capacity - used))}`);
    }
  });
});

describe("starting collections and loadouts", () => {
  it("validates every 1P, 2P and 3P composition against its own starting collection", () => {
    for (const composition of compositions()) {
      const roster = party(composition);
      const collection = createStartingCollection(roster, PACK);
      const result = validatePartyLoadout(roster, collection, PACK);
      expect(`${composition.join("+")}:${JSON.stringify(result.issues)}`).toBe(`${composition.join("+")}:[]`);
      expect(result.valid).toBe(true);
    }
  });

  it("gives every starter a deck large enough to fill an opening hand", () => {
    for (const actor of STARTERS) {
      const deck = deriveLoadoutSnapshot(actor, actor.starterLoadout, CONTENT, actor.id).deck.totalCards;
      // createCombat deals six cards; a shorter deck would open with a partial hand.
      expect(`${actor.id}:${String(deck >= 6)}`).toBe(`${actor.id}:true`);
    }
  });
});

describe("starter build identity", () => {
  it("reaches combat with a legal action on its own starting kit", () => {
    const definition = getCombatDefinition(PACK, M7_RUINED_GATE_ID);
    for (const actor of STARTERS) {
      // Each starter is dropped onto the shipped board wearing exactly what it starts with.
      const hero = buildActorSetup(
        actor,
        {
          instanceId: "hero",
          actorDefinitionId: actor.id,
          team: "heroes",
          position: { x: 1, y: 1 },
          facing: "east",
        },
        CONTENT,
      );
      const scenario = {
        ...definition.scenario,
        actors: [hero, ...definition.scenario.actors.filter((entry) => entry.team === "enemies")],
      };
      const { state } = createCombat({ ...definition, scenario }, 11);
      // The opening hand is dealt from the starter deck, so it must not come up short.
      expect(`${actor.id}:${String(state.cardZones.hero?.hand.length ?? 0)}`).toBe(`${actor.id}:6`);
      // Legality is turn-scoped, so wait for the hero's own turn before asking.
      let current = state;
      for (let guard = 0; guard < 8 && current.turn.activeActorId !== "hero"; guard += 1) {
        const result = dispatchCombatCommand(current, {
          type: "end-turn",
          id: `end-${String(current.sequence + 1)}`,
          sequence: current.sequence + 1,
          actorId: current.turn.activeActorId,
        }, CONTENT);
        expect(result.accepted).toBe(true);
        current = result.state;
      }
      expect(`${actor.id}:${current.turn.activeActorId}`).toBe(`${actor.id}:hero`);
      const legal = listLegalActions(current, "hero", CONTENT).filter((entry) => entry.enabled);
      expect(`${actor.id}:${String(legal.length > 0)}`).toBe(`${actor.id}:true`);
    }
  });

  it("gives each starter a different opening kit", () => {
    const signatures = STARTERS.map((actor) => JSON.stringify({
      equipment: actor.starterLoadout.equipment,
      prepared: [...actor.starterLoadout.preparedCards].sort(),
      grants: [...actor.baseCardGrants].map((grant) => `${grant.cardDefinitionId}x${String(grant.count)}`).sort(),
    }));
    expect(new Set(signatures).size).toBe(STARTERS.length);
  });

  it("gives each starter at least one authored weakness", () => {
    const weakness = (id: string): boolean => {
      const actor = PACK.actorDefinitions[id];
      if (actor?.statProfile.kind !== "character") throw new Error("Expected a Character.");
      const stats = actor.statProfile.stats;
      const untrainedArmor = Object.values(stats.defense.armorProficiencies).some((rank) => rank === "untrained");
      const untrainedSkill = Object.values(stats.skills).some((rank) => rank === "untrained");
      const weakAttribute = Object.values(stats.attributes).some((value) => value <= 0);
      return untrainedArmor || untrainedSkill || weakAttribute;
    };
    for (const actor of STARTERS) expect(`${actor.id}:${String(weakness(actor.id))}`).toBe(`${actor.id}:true`);
  });

  it("makes the tactician the Class DC specialist and the weakest striker", () => {
    const snapshot = (id: string) => {
      const actor = PACK.actorDefinitions[id];
      if (!actor) throw new Error(`${id} is missing.`);
      const derived = deriveLoadoutSnapshot(actor, actor.starterLoadout, CONTENT, id);
      return { ...derived.statistics, damage: derived.strike.damage.flatModifier };
    };
    const nera = snapshot("hero.nera");
    const others = ["hero.aerin", "hero.lyra", "hero.brom"].map(snapshot);
    // Expert Class DC is what makes a Class-DC card hers rather than anyone's.
    for (const other of others) expect(nera.classDc).toBeGreaterThan(other.classDc);
    // She pays for it with the lowest Strike damage and no shield.
    for (const other of others) expect(nera.damage).toBeLessThanOrEqual(other.damage);
    expect(PACK.actorDefinitions["hero.nera"]?.starterLoadout.equipment.shield).toBeUndefined();
  });
});
