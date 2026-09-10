import { describe, expect, it } from "vitest";

import { FIXTURE_ADVENTURE_ID, createCoreContentSource } from "../../tests/fixtures/content";
import { compileContentPack } from "../content";
import { PRODUCTION_CONTENT } from "../content/production-content";
import { createCombat } from "../game";
import { buildAdventureEncounter } from "./combat-bridge";
import { applyExperience, EXPERIENCE_PER_LEVEL } from "./progression";
import { createAdventureSession, deriveCombatSeed, dispatchAdventureCommand } from "./runtime";
import type {
  AdventureEvent,
  AdventureRuntimeContext,
  AdventureState,
  CharacterProgressionState,
  PartySetup,
} from "./types";

const { pack, adventure: definition } = PRODUCTION_CONTENT;
const context: AdventureRuntimeContext = {
  definition,
  actorDefinitions: pack.actorDefinitions,
  combatContent: pack.combatContent,
};
/** The core fixture authors an explicit 0 EXP per Encounter, which is what makes it useful here. */
const CORE_PACK = compileContentPack(createCoreContentSource());
const ZERO_AWARD_CONTEXT: AdventureRuntimeContext = {
  definition: CORE_PACK.adventures[FIXTURE_ADVENTURE_ID] as NonNullable<(typeof CORE_PACK.adventures)[string]>,
  actorDefinitions: CORE_PACK.actorDefinitions,
  combatContent: CORE_PACK.combatContent,
};
const HEROES = ["hero.aerin", "hero.brom", "hero.nera"] as const;

function party(ids: readonly string[] = HEROES): PartySetup {
  return {
    members: Object.fromEntries(ids.map((actorDefinitionId, index) => {
      const seat = (index + 1) as 1 | 2 | 3;
      const id = `party.hero-${String(seat)}`;
      return [id, { id, seat, actorDefinitionId, loadout: { equipment: {}, preparedCards: [] } }];
    })),
  };
}

function accept(state: AdventureState, runtime = context): ReturnType<typeof dispatchAdventureCommand> {
  const encounterId = state.currentEncounterId;
  if (!encounterId) throw new Error("Adventure has no active encounter.");
  return dispatchAdventureCommand(state, {
    type: "accept-combat-result",
    result: {
      encounterId,
      outcome: "victory",
      combatSeed: deriveCombatSeed(state.adventureSeed, encounterId),
      finalCombatHash: "fixture-hash",
    },
  }, runtime);
}

/** Drive the Adventure forward without fighting: only the growth contract is under test. */
function advance(state: AdventureState, runtime = context): { state: AdventureState; events: readonly AdventureEvent[] } {
  const won = accept(state, runtime);
  expect(won.accepted, won.error).toBe(true);
  let next = won.state;
  const offer = next.pendingReward;
  if (offer) {
    const chosen = dispatchAdventureCommand(next, { type: "choose-reward", rewardId: offer.rewardId, choiceIndex: 0 }, runtime);
    expect(chosen.accepted, chosen.error).toBe(true);
    next = chosen.state;
  }
  return { state: next, events: won.events };
}

function begun(runtime = context, ids?: readonly string[]): AdventureState {
  const ready = createAdventureSession(runtime, party(ids ?? HEROES.slice(0, 1)), 7);
  const started = dispatchAdventureCommand(ready, { type: "start-adventure" }, runtime);
  expect(started.accepted, started.error).toBe(true);
  const fighting = dispatchAdventureCommand(started.state, { type: "start-encounter" }, runtime);
  expect(fighting.accepted, fighting.error).toBe(true);
  return fighting.state;
}

function withProgression(state: AdventureState, value: CharacterProgressionState): AdventureState {
  return {
    ...state,
    party: {
      members: Object.fromEntries(Object.entries(state.party.members)
        .map(([id, member]) => [id, { ...member, progression: { ...value } }])),
    },
  };
}

describe("M9-4 experience arithmetic", () => {
  it("carries remainders, crosses several levels at once and never touches its input", () => {
    const cases: ReadonlyArray<readonly [CharacterProgressionState, number, CharacterProgressionState, number]> = [
      [{ level: 1, experience: 999 }, 1, { level: 2, experience: 0 }, 1],
      [{ level: 1, experience: 0 }, EXPERIENCE_PER_LEVEL, { level: 2, experience: 0 }, 1],
      [{ level: 1, experience: 999 }, 2, { level: 2, experience: 1 }, 1],
      [{ level: 2, experience: 700 }, 250, { level: 2, experience: 950 }, 0],
      [{ level: 1, experience: 500 }, 4_500, { level: 6, experience: 0 }, 5],
      [{ level: 3, experience: 125 }, 0, { level: 3, experience: 125 }, 0],
    ];
    for (const [before, amount, after, levelsGained] of cases) {
      const input = { ...before };
      const result = applyExperience(input, amount);
      expect(result.progression).toEqual(after);
      expect(result.levelsGained).toBe(levelsGained);
      expect(input).toEqual(before);
      expect(result.progression).not.toBe(input);
    }
  });

  it("refuses awards and totals it cannot represent exactly", () => {
    for (const amount of [-1, 0.5, NaN, Infinity, "100" as unknown as number]) {
      expect(() => applyExperience({ level: 1, experience: 0 }, amount)).toThrow();
    }
    // A total past the exact-integer range is refused rather than silently rounded.
    expect(() => applyExperience({ level: 1, experience: 999 }, Number.MAX_SAFE_INTEGER)).toThrow("represented exactly");
    // A malformed progression is refused before any arithmetic runs.
    expect(() => applyExperience({ level: 0, experience: 0 }, 10)).toThrow();
    expect(() => applyExperience({ level: 1, experience: EXPERIENCE_PER_LEVEL }, 10)).toThrow();
  });
});

describe("M9-4 encounter growth", () => {
  it("pays the authored amount to every seat in order and publishes growth between completion and what comes next", () => {
    const state = begun(context, HEROES);
    const won = accept(state);
    expect(won.accepted, won.error).toBe(true);

    expect(won.events.map((event) => event.type)).toEqual(["ENCOUNTER_COMPLETED", "EXPERIENCE_GAINED", "EXPERIENCE_GAINED", "EXPERIENCE_GAINED", "REWARD_OFFERED"]);
    const gained = won.events.filter((event) => event.type === "EXPERIENCE_GAINED");
    expect(gained.map((event) => event.memberId)).toEqual(["party.hero-1", "party.hero-2", "party.hero-3"]);
    for (const event of gained) {
      expect(event.amount).toBe(200);
      expect(event.encounterId).toBe("encounter.road-ambush");
      expect(event.previous).toEqual({ level: 1, experience: 0 });
      expect(event.next).toEqual({ level: 1, experience: 200 });
    }
    for (const member of Object.values(won.state.party.members)) {
      expect(member.progression).toEqual({ level: 1, experience: 200 });
    }
  });

  it("reaches Lv.2 on the fourth victory and Lv.3 on the seventh, and stops paying once the run is over", () => {
    let state = begun(context, HEROES);
    const levels: number[] = [];
    const experience: number[] = [];
    const levelUpAfter: string[] = [];
    for (let index = 0; index < definition.encounterIds.length; index += 1) {
      const step = advance(state);
      state = step.state;
      const member = state.party.members["party.hero-1"];
      if (!member) throw new Error("Party member went missing.");
      levels.push(member.progression.level);
      experience.push(member.progression.experience);
      for (const event of step.events) {
        // One seat is enough to read the pacing; the others are checked for parity elsewhere.
        if (event.type === "LEVEL_UP" && event.memberId === "party.hero-1") {
          levelUpAfter.push(`${event.encounterId}:${String(event.previousLevel)}->${String(event.level)}`);
        }
      }
      if (state.phase === "between-encounters") {
        const entered = dispatchAdventureCommand(state, { type: "start-encounter" }, context);
        expect(entered.accepted, entered.error).toBe(true);
        state = entered.state;
      }
    }

    // The authored pacing from the plan, read straight off the run.
    expect(levels).toEqual([1, 1, 1, 2, 2, 2, 3, 3]);
    expect(experience).toEqual([200, 450, 700, 100, 350, 650, 0, 500]);
    expect(levelUpAfter).toEqual(["encounter.goblin-chief:1->2", "encounter.archer-perch:2->3"]);
    expect(state.phase).toBe("complete");
    // A finished Adventure has nothing left to award, and says so rather than paying twice.
    expect(dispatchAdventureCommand(state, {
      type: "accept-combat-result",
      result: {
        encounterId: "encounter.cult-sanctum",
        outcome: "victory",
        combatSeed: deriveCombatSeed(state.adventureSeed, "encounter.cult-sanctum"),
        finalCombatHash: "fixture-hash",
      },
    }, context).accepted).toBe(false);
  });

  it("publishes one LEVEL_UP per level crossed, in seat order after every award", () => {
    const state = withProgression(begun(context, HEROES), { level: 4, experience: 900 });
    // 900 + 4200 crosses five thresholds in a single battle.
    const boosted: AdventureRuntimeContext = {
      ...context,
      definition: {
        ...definition,
        experienceAwards: definition.experienceAwards.map((award) =>
          award.afterEncounterId === "encounter.road-ambush" ? { ...award, amount: 4_200 } : award),
      },
    };
    const won = accept(state, boosted);
    expect(won.accepted, won.error).toBe(true);

    const types = won.events.map((event) => event.type);
    expect(types.indexOf("EXPERIENCE_GAINED")).toBeLessThan(types.indexOf("LEVEL_UP"));
    expect(types.lastIndexOf("EXPERIENCE_GAINED")).toBeLessThan(types.indexOf("LEVEL_UP"));
    const levelUps = won.events.filter((event) => event.type === "LEVEL_UP");
    expect(levelUps).toHaveLength(15);
    expect(levelUps.slice(0, 5).map((event) => [event.memberId, event.previousLevel, event.level])).toEqual([
      ["party.hero-1", 4, 5], ["party.hero-1", 5, 6], ["party.hero-1", 6, 7], ["party.hero-1", 7, 8], ["party.hero-1", 8, 9],
    ]);
    expect(levelUps[5]?.memberId).toBe("party.hero-2");
    expect(won.state.party.members["party.hero-1"]?.progression).toEqual({ level: 9, experience: 100 });
  });

  it("pays a member who was down when the battle ended exactly what the rest of the party gets", () => {
    const state = begun(context, HEROES);
    const encounter = buildAdventureEncounter(pack, state);
    const combat = createCombat(encounter.definition, encounter.seed).state;
    const downed = { ...combat.actors["party.hero-3"], hp: 0, defeated: true };
    expect(downed.defeated).toBe(true);

    const won = accept(state);
    expect(won.accepted, won.error).toBe(true);
    // Nothing in the award path reads Combat at all: the result says victory, so the party grew.
    const amounts = won.events.filter((event) => event.type === "EXPERIENCE_GAINED").map((event) => event.amount);
    expect(amounts).toEqual([200, 200, 200]);
  });

  it("pays nothing on defeat, on a reward choice, or for an explicit zero award", () => {
    const state = begun(context, HEROES);
    const lost = dispatchAdventureCommand(state, {
      type: "accept-combat-result",
      result: {
        encounterId: state.currentEncounterId ?? "",
        outcome: "defeat",
        combatSeed: deriveCombatSeed(state.adventureSeed, state.currentEncounterId ?? ""),
        finalCombatHash: "fixture-hash",
      },
    }, context);
    expect(lost.accepted).toBe(true);
    expect(lost.state.party).toEqual(state.party);
    expect(lost.events.map((event) => event.type)).toEqual(["ADVENTURE_FAILED"]);

    const won = accept(state);
    expect(won.accepted).toBe(true);
    const offer = won.state.pendingReward;
    if (!offer) throw new Error("The first production encounter offers a reward.");
    const chosen = dispatchAdventureCommand(won.state, { type: "choose-reward", rewardId: offer.rewardId, choiceIndex: 0 }, context);
    expect(chosen.accepted, chosen.error).toBe(true);
    expect(chosen.state.party).toEqual(won.state.party);
    expect(chosen.events.some((event) => event.type === "EXPERIENCE_GAINED" || event.type === "LEVEL_UP")).toBe(false);

    // The M3 regression fixture authors an explicit 0, which must stay silent rather than
    // publishing an award of nothing.
    const fixture = accept(begun(ZERO_AWARD_CONTEXT), ZERO_AWARD_CONTEXT);
    expect(fixture.accepted, fixture.error).toBe(true);
    expect(fixture.events.some((event) => event.type === "EXPERIENCE_GAINED" || event.type === "LEVEL_UP")).toBe(false);
    expect(fixture.state.party.members["party.hero-1"]?.progression).toEqual({ level: 1, experience: 0 });
  });

  it("grows parties that started at different levels independently and feeds the next battle", () => {
    const state = begun(context, HEROES);
    const mixed: AdventureState = {
      ...state,
      party: {
        members: {
          ...state.party.members,
          "party.hero-1": { ...state.party.members["party.hero-1"]!, progression: { level: 1, experience: 850 } },
          "party.hero-2": { ...state.party.members["party.hero-2"]!, progression: { level: 3, experience: 10 } },
        },
      },
    };
    const won = accept(mixed);
    expect(won.accepted, won.error).toBe(true);
    expect(won.state.party.members["party.hero-1"]?.progression).toEqual({ level: 2, experience: 50 });
    expect(won.state.party.members["party.hero-2"]?.progression).toEqual({ level: 3, experience: 210 });
    expect(won.state.party.members["party.hero-3"]?.progression).toEqual({ level: 1, experience: 200 });
    expect(won.events.filter((event) => event.type === "LEVEL_UP").map((event) => event.memberId)).toEqual(["party.hero-1"]);

    const offer = won.state.pendingReward;
    if (!offer) throw new Error("The first production encounter offers a reward.");
    const chosen = dispatchAdventureCommand(won.state, { type: "choose-reward", rewardId: offer.rewardId, choiceIndex: 0 }, context);
    expect(chosen.accepted, chosen.error).toBe(true);
    const entered = dispatchAdventureCommand(chosen.state, { type: "start-encounter" }, context);
    expect(entered.accepted, entered.error).toBe(true);

    // The next battle is built from the new Level and opens at the new full HP.
    const before = createCombat(...(() => {
      const built = buildAdventureEncounter(pack, state);
      return [built.definition, built.seed] as const;
    })()).state;
    const after = createCombat(...(() => {
      const built = buildAdventureEncounter(pack, entered.state);
      return [built.definition, built.seed] as const;
    })()).state;
    const grown = after.actors["party.hero-1"];
    const original = before.actors["party.hero-1"];
    if (!grown || !original) throw new Error("Hero went missing from the encounter.");
    expect(grown.statProfile).toMatchObject({ stats: { level: 2 } });
    expect(grown.maxHp).toBeGreaterThan(original.maxHp);
    expect(grown.hp).toBe(grown.maxHp);
  });
});
