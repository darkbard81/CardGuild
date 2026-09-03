import { describe, expect, it } from "vitest";

import { buildResolvedActionPlan } from "../game/action-plan";
import { createCombat, dispatchCombatCommand } from "../game/engine";
import { listLegalActions } from "../game/queries";
import { SKILL_IDS, ATTRIBUTE_IDS, SAVE_IDS, resolveClassDC, resolveStatisticModifier } from "../game/statistics";
import type { ActionTarget, ActorDefinitionId, ActorState, CombatState } from "../game/types";
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

/** One starter on the board with a chosen kit, plus a live enemy to aim at. */
function actorWith(definitionId: string, equipmentIds?: readonly string[]): ActorState {
  const definition = PACK.actorDefinitions[definitionId];
  if (!definition) throw new Error(`Actor definition "${definitionId}" is missing.`);
  const actor = buildActorSetup(
    definition,
    { instanceId: "hero", actorDefinitionId: definitionId, team: "heroes", position: { x: 1, y: 1 }, facing: "east" },
    CONTENT,
  );
  return {
    ...actor,
    equipmentIds: equipmentIds ? [...equipmentIds] : actor.equipmentIds,
    reactionAvailable: true,
    shieldRaised: false,
    defeated: false,
  };
}

const TARGET_ENEMY: ActorState = (() => {
  const definition = PACK.actorDefinitions["enemy.goblin-skirmisher"];
  if (!definition) throw new Error("Enemy definition is missing.");
  const actor = buildActorSetup(
    definition,
    { instanceId: "enemy", actorDefinitionId: "enemy.goblin-skirmisher", team: "enemies", position: { x: 2, y: 1 }, facing: "west" },
    CONTENT,
  );
  return { ...actor, reactionAvailable: true, shieldRaised: false, defeated: false };
})();

/** The plan a card would produce, or null when the starter cannot resolve it at all. */
function planOf(actor: ActorState, actionId: string, target: ActionTarget) {
  const definition = CONTENT.actions[actionId];
  if (!definition) throw new Error(`Action "${actionId}" is missing.`);
  const state = { actors: { [actor.id]: actor, [TARGET_ENEMY.id]: TARGET_ENEMY } } as unknown as CombatState;
  return buildResolvedActionPlan(
    definition, actor, target, { kind: "card", id: "unused" }, state, CONTENT, { kind: "turn", attacksThisTurn: 0 },
  );
}

const ENEMY_TARGET: ActionTarget = { kind: "actor", actorId: "enemy" };

describe("starter signature actions", () => {
  it("resolves Aerin's reach control at her authored weapon reach", () => {
    const aerin = actorWith("hero.aerin");
    const knockdown = planOf(aerin, "knockdown", ENEMY_TARGET);
    if (knockdown?.resolution.kind !== "strike") throw new Error("Knockdown must resolve as a Strike.");
    expect(knockdown.resolution.strike.rangeFeet).toBe(10);
    expect(knockdown.resolution.outcomes.success.some((effect) =>
      effect.kind === "apply-condition" && effect.condition === "prone")).toBe(true);
    // Intimidating Strike carries a melee requirement her halberd satisfies.
    expect(planOf(aerin, "intimidating-strike", ENEMY_TARGET)).not.toBeNull();
  });

  it("resolves Lyra's pin with a finesse weapon and her Acrobatics escape", () => {
    const lyra = actorWith("hero.lyra");
    expect(planOf(lyra, "combat-grab", ENEMY_TARGET)).not.toBeNull();
    const slip = planOf(lyra, "slip-free", { kind: "none" });
    if (slip?.resolution.kind !== "check") throw new Error("Slip Free must resolve as a check.");
    expect(slip.resolution.check.modifier).toBe(
      resolveStatisticModifier(lyra, { kind: "skill", id: "acrobatics" }, { content: CONTENT }).value,
    );
  });

  it("gives Brom the party's strongest Grapple", () => {
    const grappleModifier = (id: string): number => {
      const plan = planOf(actorWith(id), "grapple", ENEMY_TARGET);
      if (plan?.resolution.kind !== "check") throw new Error("Grapple must resolve as a check.");
      return plan.resolution.check.modifier;
    };
    const brom = grappleModifier("hero.brom");
    for (const other of ["hero.aerin", "hero.lyra", "hero.nera"]) {
      expect(`${other}:${String(brom > grappleModifier(other))}`).toBe(`${other}:true`);
    }
  });

  it("rolls Nera's control against her expert Class DC", () => {
    const nera = actorWith("hero.nera");
    const plan = planOf(nera, "iron-presence", ENEMY_TARGET);
    if (plan?.resolution.kind !== "check") throw new Error("Iron Presence must resolve as a check.");
    expect(plan.resolution.check.roller).toBe("target");
    expect(plan.resolution.check.dc).toBe(resolveClassDC(nera, { content: CONTENT }).value);
    expect(plan.resolution.check.dc).toBe(19);
  });

  it("leaves Nera's Athletics cards legal but weak, and opens Combat Grab with a melee weapon", () => {
    // untrained is not a legality gate: only an authored `skill-rank` requirement checks a
    // rank, and Trip and Grapple author none. Nera's weakness is the modifier, not a ban.
    const nera = actorWith("hero.nera");
    for (const actionId of ["trip", "grapple"]) {
      const plan = planOf(nera, actionId, ENEMY_TARGET);
      if (plan?.resolution.kind !== "check") throw new Error(`${actionId} must resolve as a check.`);
      expect(`${actionId}:${String(plan.resolution.check.modifier)}`).toBe(`${actionId}:0`);
    }
    // Combat Grab is closed by the weapon requirement alone, so a melee reward opens it.
    expect(planOf(nera, "combat-grab", ENEMY_TARGET)).toBeNull();
    expect(planOf(actorWith("hero.nera", ["light-blade", "leather-armor"]), "combat-grab", ENEMY_TARGET)).not.toBeNull();
  });

  it("keeps Battle Medicine aimed at a wounded teammate only", () => {
    const nera = actorWith("hero.nera");
    const wounded: ActorState = { ...actorWith("hero.brom"), id: "ally", hp: 4 };
    const state = { actors: { hero: nera, ally: wounded, enemy: TARGET_ENEMY } } as unknown as CombatState;
    const definition = CONTENT.actions["battle-medicine"];
    if (!definition) throw new Error("Battle Medicine is missing.");
    const aimed = (actorId: string) => buildResolvedActionPlan(
      definition, nera, { kind: "actor", actorId }, { kind: "card", id: "unused" }, state, CONTENT,
      { kind: "turn", attacksThisTurn: 0 },
    );
    // Her Medicine expert satisfies the skill-rank requirement the card authors.
    expect(aimed("ally")).not.toBeNull();
    expect(definition.targeting).toBe("ally");
  });
});
