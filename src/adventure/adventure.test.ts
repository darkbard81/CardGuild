import { describe, expect, it } from "vitest";

import {
  M2_ADVENTURE,
  M2_COMPILED_PACK,
  M2_GOBLIN_CHIEF_ID,
  M2_ROAD_AMBUSH_ID,
  M2_RUINED_GATE_ID,
} from "../content";
import { createCombat } from "../game";
import { buildAdventureEncounter } from "./combat-bridge";
import { createAdventureSession, deriveCombatSeed, dispatchAdventureCommand } from "./runtime";
import type { AdventureState, EncounterResult, PartyState } from "./types";

const party: PartyState = {
  members: {
    "party.hero-1": {
      id: "party.hero-1",
      actorDefinitionId: "hero.aerin",
      equipmentIds: ["halberd"],
    },
  },
};

function start(seed = 41): AdventureState {
  const ready = createAdventureSession(M2_ADVENTURE, party, seed);
  const started = dispatchAdventureCommand(ready, { type: "start-adventure" }, M2_ADVENTURE);
  const combat = dispatchAdventureCommand(started.state, { type: "start-encounter" }, M2_ADVENTURE);
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
    expect(deriveCombatSeed(41, M2_ROAD_AMBUSH_ID)).toBe(deriveCombatSeed(41, M2_ROAD_AMBUSH_ID));
    expect(deriveCombatSeed(41, M2_ROAD_AMBUSH_ID)).not.toBe(deriveCombatSeed(41, M2_RUINED_GATE_ID));
    expect(deriveCombatSeed(41, M2_ROAD_AMBUSH_ID)).not.toBe(0);
  });

  it("runs all three encounters in authored order and retains chosen rewards", () => {
    let state = start();
    expect(state.currentEncounterId).toBe(M2_ROAD_AMBUSH_ID);

    for (const [index, encounterId] of [M2_ROAD_AMBUSH_ID, M2_RUINED_GATE_ID, M2_GOBLIN_CHIEF_ID].entries()) {
      expect(state.phase).toBe("combat");
      expect(state.currentEncounterId).toBe(encounterId);
      const accepted = dispatchAdventureCommand(
        state,
        { type: "accept-combat-result", result: resultFor(state, "victory") },
        M2_ADVENTURE,
      );
      expect(accepted.accepted).toBe(true);
      state = accepted.state;

      if (index < 2) {
        expect(state.phase).toBe("reward");
        const offer = state.pendingReward as NonNullable<AdventureState["pendingReward"]>;
        const rewarded = dispatchAdventureCommand(
          state,
          { type: "choose-reward", rewardId: offer.rewardId, choiceIndex: 0 },
          M2_ADVENTURE,
        );
        expect(rewarded.accepted).toBe(true);
        state = rewarded.state;
        expect(state.phase).toBe("between-encounters");
        state = dispatchAdventureCommand(state, { type: "continue-adventure" }, M2_ADVENTURE).state;
      }
    }

    expect(state.phase).toBe("complete");
    expect(state.completedEncounterIds).toEqual([
      M2_ROAD_AMBUSH_ID,
      M2_RUINED_GATE_ID,
      M2_GOBLIN_CHIEF_ID,
    ]);
    expect(state.collection.equipment).toEqual({ "boots-of-fly": 1, shield: 1 });
  });

  it("marks the Adventure failed on defeat and rejects a mismatched seed", () => {
    const combat = start(12);
    const mismatched = dispatchAdventureCommand(
      combat,
      { type: "accept-combat-result", result: { ...resultFor(combat, "victory"), combatSeed: 99 } },
      M2_ADVENTURE,
    );
    expect(mismatched.accepted).toBe(false);

    const failed = dispatchAdventureCommand(
      combat,
      { type: "accept-combat-result", result: resultFor(combat, "defeat") },
      M2_ADVENTURE,
    );
    expect(failed.accepted).toBe(true);
    expect(failed.state.phase).toBe("failed");
    expect(failed.events).toContainEqual({ type: "ADVENTURE_FAILED", encounterId: M2_ROAD_AMBUSH_ID });
  });

  it("builds a fresh CombatState from party loadout without carrying encounter-local state", () => {
    const state = start(77);
    const encounter = buildAdventureEncounter(M2_COMPILED_PACK, state);
    const first = createCombat(encounter.definition, encounter.seed).state;
    const second = createCombat(encounter.definition, encounter.seed).state;
    const hero = first.actors.hero;

    expect(hero?.definitionId).toBe("hero.aerin");
    expect(hero?.equipmentIds).toEqual(["halberd"]);
    expect(hero?.hp).toBe(hero?.maxHp);
    expect(hero?.conditions).toEqual([]);
    expect(first).toEqual(second);
    expect("combatState" in state).toBe(false);
  });
});
