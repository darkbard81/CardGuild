import { describe, expect, it } from "vitest";

import {
  M3_ADVENTURE,
  M3_COMPILED_PACK,
  M3_GOBLIN_CHIEF_ID,
  M3_ROAD_AMBUSH_ID,
  M3_RUINED_GATE_ID,
} from "../content";
import { createCombat, resolveStatisticDC } from "../game";
import { deriveLoadoutSnapshot } from "../loadout";
import { buildAdventureEncounter } from "./combat-bridge";
import { createAdventureSession, deriveCombatSeed, dispatchAdventureCommand } from "./runtime";
import type { AdventureRuntimeContext, AdventureState, EncounterResult, PartyState } from "./types";

const context: AdventureRuntimeContext = {
  definition: M3_ADVENTURE,
  actorDefinitions: M3_COMPILED_PACK.actorDefinitions,
  combatContent: M3_COMPILED_PACK.combatContent,
};

const aerin = M3_COMPILED_PACK.actorDefinitions["hero.aerin"] as NonNullable<
  (typeof M3_COMPILED_PACK.actorDefinitions)["hero.aerin"]
>;

function partyWithStarter(): PartyState {
  return {
    members: {
      "party.hero-1": {
        id: "party.hero-1",
        seat: 1,
        actorDefinitionId: aerin.id,
        loadout: {
          equipment: { ...aerin.starterLoadout.equipment },
          preparedCards: [...aerin.starterLoadout.preparedCards],
        },
      },
    },
  };
}

function partyWithSize(size: 1 | 2 | 3): PartyState {
  return {
    members: Object.fromEntries(Array.from({ length: size }, (_, index) => {
      const seat = (index + 1) as 1 | 2 | 3;
      const id = `party.hero-${seat}`;
      return [id, {
        id,
        seat,
        actorDefinitionId: aerin.id,
        loadout: {
          equipment: { ...aerin.starterLoadout.equipment },
          preparedCards: [...aerin.starterLoadout.preparedCards],
        },
      }];
    })),
  };
}

function start(seed = 41): AdventureState {
  const ready = createAdventureSession(context, partyWithStarter(), seed);
  const started = dispatchAdventureCommand(ready, { type: "start-adventure" }, context);
  const combat = dispatchAdventureCommand(started.state, { type: "start-encounter" }, context);
  expect(started.accepted).toBe(true);
  expect(combat.accepted).toBe(true);
  return combat.state;
}

function resultFor(state: AdventureState, outcome: EncounterResult["outcome"]): EncounterResult {
  const encounterId = state.currentEncounterId as string;
  return {
    encounterId,
    outcome,
    combatSeed: deriveCombatSeed(state.adventureSeed, encounterId),
    finalCombatHash: `test:${encounterId}:${outcome}`,
  };
}

describe("Adventure runtime", () => {
  it("derives a stable, encounter-specific non-zero combat seed", () => {
    expect(deriveCombatSeed(41, M3_ROAD_AMBUSH_ID)).toBe(deriveCombatSeed(41, M3_ROAD_AMBUSH_ID));
    expect(deriveCombatSeed(41, M3_ROAD_AMBUSH_ID)).not.toBe(deriveCombatSeed(41, M3_RUINED_GATE_ID));
    expect(deriveCombatSeed(41, M3_ROAD_AMBUSH_ID)).not.toBe(0);
  });

  it("starts with transferable loadout ownership and retains rewards without consuming copies", () => {
    let state = start();
    expect(state.currentEncounterId).toBe(M3_ROAD_AMBUSH_ID);
    expect(state.collection.equipment).toEqual({ halberd: 1, shield: 1, "boots-of-fly": 1 });

    for (const [index, encounterId] of [M3_ROAD_AMBUSH_ID, M3_RUINED_GATE_ID, M3_GOBLIN_CHIEF_ID].entries()) {
      expect(state.currentEncounterId).toBe(encounterId);
      state = dispatchAdventureCommand(
        state,
        { type: "accept-combat-result", result: resultFor(state, "victory") },
        context,
      ).state;

      if (index < 2) {
        const offer = state.pendingReward as NonNullable<AdventureState["pendingReward"]>;
        state = dispatchAdventureCommand(
          state,
          { type: "choose-reward", rewardId: offer.rewardId, choiceIndex: 0 },
          context,
        ).state;
        state = dispatchAdventureCommand(state, { type: "continue-adventure" }, context).state;
      }
    }

    expect(state.phase).toBe("complete");
    expect(state.completedEncounterIds).toEqual([
      M3_ROAD_AMBUSH_ID,
      M3_RUINED_GATE_ID,
      M3_GOBLIN_CHIEF_ID,
    ]);
    expect(state.collection.equipment).toEqual({ halberd: 1, "boots-of-fly": 2, shield: 2 });
  });

  it("derives starting ownership and equipped loadout from actor definitions, not caller data", () => {
    const injected: PartyState = {
      members: {
        "party.hero-1": {
          id: "party.hero-1",
          seat: 1,
          actorDefinitionId: aerin.id,
          loadout: { equipment: {}, preparedCards: ["card.fly", "card.fly"] },
        },
      },
    };

    const state = createAdventureSession(context, injected, 19);

    expect(state.party.members["party.hero-1"]?.loadout).toEqual(aerin.starterLoadout);
    expect(state.collection).toEqual({
      equipment: { halberd: 1, shield: 1, "boots-of-fly": 1 },
      cards: {},
    });
  });

  it("starts the same adventure with one to three stable party members and deterministic spawn slots", () => {
    const setupFingerprints: string[] = [];
    for (const size of [1, 2, 3] as const) {
      let state = createAdventureSession(context, partyWithSize(size), 23);
      state = dispatchAdventureCommand(state, { type: "start-adventure" }, context).state;
      state = dispatchAdventureCommand(state, { type: "start-encounter" }, context).state;
      const encounter = buildAdventureEncounter(M3_COMPILED_PACK, state);
      setupFingerprints.push(createCombat(encounter.definition, encounter.seed).state.setupFingerprint);
      const heroActors = encounter.definition.scenario.actors.filter((actor) => actor.team === "heroes");

      expect(heroActors.map((actor) => actor.id)).toEqual(
        Array.from({ length: size }, (_, index) => `party.hero-${index + 1}`),
      );
      expect(heroActors.map((actor) => actor.position)).toEqual(
        M3_COMPILED_PACK.scenarioSources[M3_ROAD_AMBUSH_ID]?.partySpawnSlots
          .slice(0, size)
          .map((slot) => slot.position),
      );
      expect(state.collection.equipment).toEqual({
        halberd: size,
        shield: size,
        "boots-of-fly": size,
      });
    }
    expect(setupFingerprints[0]).not.toBe(setupFingerprints[2]);
  });

  it("atomically changes loadout only in ready and between-encounters phases", () => {
    const ready = createAdventureSession(context, partyWithStarter(), 17);
    const member = ready.party.members["party.hero-1"] as NonNullable<typeof ready.party.members[string]>;
    const withoutShield = {
      equipment: { weapon: "halberd" as const, feet: "boots-of-fly" as const },
      preparedCards: [],
    };
    const changed = dispatchAdventureCommand(
      ready,
      { type: "set-member-loadout", memberId: member.id, loadout: withoutShield },
      context,
    );
    expect(changed.accepted).toBe(true);
    expect(changed.state.collection).toEqual(ready.collection);
    expect(changed.events).toEqual([{
      type: "LOADOUT_CHANGED",
      memberId: member.id,
      previous: member.loadout,
      next: withoutShield,
    }]);

    const unowned = dispatchAdventureCommand(
      ready,
      {
        type: "set-member-loadout",
        memberId: member.id,
        loadout: { ...member.loadout, preparedCards: ["card.fly"] },
      },
      context,
    );
    expect(unowned.accepted).toBe(false);
    expect(unowned.state).toBe(ready);
    expect(unowned.events).toEqual([]);

    const combat = start(17);
    const rejected = dispatchAdventureCommand(
      combat,
      { type: "set-member-loadout", memberId: member.id, loadout: withoutShield },
      context,
    );
    expect(rejected.accepted).toBe(false);
    expect(rejected.state).toBe(combat);
    expect(rejected.events).toEqual([]);
  });

  it("marks the Adventure failed on defeat and rejects a mismatched seed", () => {
    const combat = start(12);
    const mismatched = dispatchAdventureCommand(
      combat,
      { type: "accept-combat-result", result: { ...resultFor(combat, "victory"), combatSeed: 99 } },
      context,
    );
    expect(mismatched.accepted).toBe(false);

    const failed = dispatchAdventureCommand(
      combat,
      { type: "accept-combat-result", result: resultFor(combat, "defeat") },
      context,
    );
    expect(failed.accepted).toBe(true);
    expect(failed.state.phase).toBe("failed");
    expect(failed.events).toContainEqual({ type: "ADVENTURE_FAILED", encounterId: M3_ROAD_AMBUSH_ID });
  });

  it("builds a fresh CombatState from the shared derived loadout", () => {
    const state = start(77);
    const encounter = buildAdventureEncounter(M3_COMPILED_PACK, state);
    const first = createCombat(encounter.definition, encounter.seed).state;
    const second = createCombat(encounter.definition, encounter.seed).state;
    const hero = first.actors["party.hero-1"];

    expect(hero?.equipmentIds).toEqual(["halberd", "shield", "boots-of-fly"]);
    expect(hero?.deckContributions.reduce((total, entry) => total + entry.count, 0)).toBe(8);
    expect(hero?.hp).toBe(hero?.maxHp);
    expect(first).toEqual(second);
    expect(first.setupFingerprint).toMatch(/^fnv1a64:[0-9a-f]{16}$/);
    expect("combatState" in state).toBe(false);
  });

  it("matches reward loadout preview to the next CombatState deck, stats, and provenance", () => {
    let state = start(78);
    state = dispatchAdventureCommand(
      state,
      { type: "accept-combat-result", result: resultFor(state, "victory") },
      context,
    ).state;
    const offer = state.pendingReward as NonNullable<AdventureState["pendingReward"]>;
    state = dispatchAdventureCommand(
      state,
      { type: "choose-reward", rewardId: offer.rewardId, choiceIndex: 1 },
      context,
    ).state;
    const member = state.party.members["party.hero-1"] as NonNullable<typeof state.party.members[string]>;
    const nextLoadout = { equipment: { weapon: "halberd" as const }, preparedCards: ["card.fly"] };
    const preview = deriveLoadoutSnapshot(aerin, nextLoadout, context.combatContent, member.id);
    state = dispatchAdventureCommand(
      state,
      { type: "set-member-loadout", memberId: member.id, loadout: nextLoadout },
      context,
    ).state;
    state = dispatchAdventureCommand(state, { type: "continue-adventure" }, context).state;

    const encounter = buildAdventureEncounter(M3_COMPILED_PACK, state);
    const combat = createCombat(encounter.definition, encounter.seed).state;
    const hero = combat.actors["party.hero-1"] as NonNullable<typeof combat.actors[string]>;
    expect(hero.equipmentIds).toEqual(preview.equipmentIds);
    expect(hero.deckContributions).toEqual(preview.deck.contributions);
    expect(resolveStatisticDC(
      hero,
      { kind: "save", id: "reflex" },
      { content: context.combatContent },
    ).value).toBe(preview.statistics.reflex.dc);
    expect(hero.deckContributions).toContainEqual({
      cardDefinitionId: "card.fly",
      count: 1,
      source: { kind: "prepared", memberId: member.id },
    });
    expect(preview.contextActionIds).not.toContain("raise-shield");
  });
});
