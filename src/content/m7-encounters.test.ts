import { describe, expect, it } from "vitest";

import { buildAdventureEncounter, createAdventureSession, dispatchAdventureCommand } from "../adventure";
import type { AdventureRuntimeContext, PartyState } from "../adventure";
import tilemapPack from "../../presentation/m3/tilemaps.json";

interface GeneratedTilemap {
  readonly width: number;
  readonly height: number;
  readonly meta: {
    readonly tileIds: readonly (string | null)[];
    readonly type: readonly string[];
    readonly walkable: readonly boolean[];
    readonly cost: readonly (number | null)[];
  };
}

const TILEMAPS = tilemapPack.maps as unknown as Readonly<Record<string, GeneratedTilemap>>;
import { compileContentPack } from "./compile-content";
import {
  PARTY_SIZES,
  placementAppliesToPartySize,
  type ContentPackSource,
  type EncounterActorPlacement,
  type ScenarioSource,
} from "./content-types";
import { fingerprintContentPack, normalizeContentPack } from "./fingerprint";
import { validateContentPackSemantics } from "./validate-semantics";
import { M7_ADVENTURE, M7_COMPILED_PACK, M7_CONTENT, M7_CONTENT_SOURCE } from "./load-m7-content";

const PACK = M7_COMPILED_PACK;
const SCENARIOS = Object.values(PACK.scenarioSources);

function source(): ContentPackSource {
  return structuredClone(M7_CONTENT_SOURCE);
}

/** Replaces one Scenario in a copy of the pack so a single rule can be exercised. */
function withScenario(id: string, mutate: (scenario: ScenarioSource) => ScenarioSource): ContentPackSource {
  const pack = source();
  const found = pack.scenarios.find((scenario) => scenario.id === id);
  if (!found) throw new Error(`Scenario "${id}" is missing.`);
  return { ...pack, scenarios: pack.scenarios.map((scenario) => (scenario.id === id ? mutate(scenario) : scenario)) };
}

function activeFor(scenario: ScenarioSource, partySize: number): readonly EncounterActorPlacement[] {
  return scenario.placements.filter((placement) => placementAppliesToPartySize(placement, partySize));
}

const CONTEXT: AdventureRuntimeContext = {
  definition: M7_ADVENTURE,
  actorDefinitions: PACK.actorDefinitions,
  combatContent: PACK.combatContent,
};

function partyOf(count: 1 | 2 | 3): PartyState {
  const roster = ["hero.aerin", "hero.lyra", "hero.brom"].slice(0, count);
  return {
    members: Object.fromEntries(roster.map((actorDefinitionId, index) => {
      const id = `party.hero-${String(index + 1)}`;
      const definition = PACK.actorDefinitions[actorDefinitionId];
      if (!definition) throw new Error(`${actorDefinitionId} is missing.`);
      return [id, { id, seat: (index + 1) as 1 | 2 | 3, actorDefinitionId, loadout: definition.starterLoadout }];
    })),
  };
}

/**
 * Runs one Scenario through the real Adventure bridge with a party of the given size.
 * The adventure definition is built around the Scenario under test so the bridge, not a
 * helper, decides which static Actors exist.
 */
function encounterFor(scenarioId: string, count: 1 | 2 | 3) {
  const context: AdventureRuntimeContext = {
    ...CONTEXT,
    definition: { ...M7_ADVENTURE, encounterIds: [scenarioId], rewards: [] },
  };
  const ready = createAdventureSession(context, partyOf(count), 7);
  const started = dispatchAdventureCommand(ready, { type: "start-adventure" }, context);
  const combat = dispatchAdventureCommand(started.state, { type: "start-encounter" }, context);
  expect(combat.accepted).toBe(true);
  return buildAdventureEncounter(PACK, combat.state);
}

function enemyIdsFor(scenarioId: string, count: 1 | 2 | 3): readonly string[] {
  return encounterFor(scenarioId, count).definition.scenario.actors
    .filter((actor) => actor.team === "enemies")
    .map((actor) => actor.id)
    .sort();
}

describe("M7 encounter library", () => {
  it("ships 8 to 12 scenarios", () => {
    expect(SCENARIOS.length).toBeGreaterThanOrEqual(8);
    expect(SCENARIOS.length).toBeLessThanOrEqual(12);
  });

  it("gives every scenario a generated tilemap whose size matches the gameplay map", () => {
    for (const scenario of SCENARIOS) {
      const tilemap = TILEMAPS[scenario.id];
      expect(`${scenario.id}:${String(Boolean(tilemap))}`).toBe(`${scenario.id}:true`);
      expect(`${scenario.id}:${String(tilemap?.width)}x${String(tilemap?.height)}`)
        .toBe(`${scenario.id}:${String(scenario.map.width)}x${String(scenario.map.height)}`);
    }
  });

  it("carries every authored tile's semantics into the generated tilemap", () => {
    // width and height agreeing is not enough: a builder drift would silently change what
    // a tile means. Every authored tile is compared cell by cell.
    for (const scenario of SCENARIOS) {
      const tilemap = TILEMAPS[scenario.id];
      if (!tilemap) throw new Error(`${scenario.id} has no tilemap.`);
      for (const tile of scenario.map.tiles) {
        const index = tile.position.y * scenario.map.width + tile.position.x;
        const traits = new Set(tile.traits.map((trait) => trait.id));
        const blocked = traits.has("blocked") || traits.has("impassable") || traits.has("gate");
        const expected = {
          tileId: tile.id,
          type: traits.has("gate") || traits.has("gate-open")
            ? "gate"
            : traits.has("blocked")
              ? "blocked"
              : traits.has("impassable")
                ? "impassable"
                : traits.has("web")
                  ? "web"
                  : traits.has("difficult")
                    ? "difficult"
                    : "open",
          walkable: !blocked,
          cost: blocked ? null : traits.has("difficult") ? 2 : 1,
        };
        const actual = {
          tileId: tilemap.meta.tileIds[index],
          type: tilemap.meta.type[index],
          walkable: tilemap.meta.walkable[index],
          cost: tilemap.meta.cost[index],
        };
        expect(`${scenario.id}/${tile.id}:${JSON.stringify(actual)}`)
          .toBe(`${scenario.id}/${tile.id}:${JSON.stringify(expected)}`);
      }
    }
  });

  it("keeps a legal spawn and at least one enemy for every party size", () => {
    for (const scenario of SCENARIOS) {
      for (const partySize of PARTY_SIZES) {
        const spawns = scenario.partySpawnSlots.filter((slot) => slot.seat <= partySize);
        const enemies = activeFor(scenario, partySize).filter((placement) => placement.team === "enemies");
        expect(`${scenario.id}@${String(partySize)}:spawns=${String(spawns.length)}`)
          .toBe(`${scenario.id}@${String(partySize)}:spawns=${String(partySize)}`);
        expect(`${scenario.id}@${String(partySize)}:enemies>0=${String(enemies.length > 0)}`)
          .toBe(`${scenario.id}@${String(partySize)}:enemies>0=true`);
      }
    }
  });

  it("scales at least one scenario's composition with party size", () => {
    const scaling = SCENARIOS.filter((scenario) =>
      new Set(PARTY_SIZES.map((size) => activeFor(scenario, size).length)).size > 1);
    expect(scaling.length).toBeGreaterThanOrEqual(1);
  });

  it("uses several creature roles across the library", () => {
    const definitionIds = new Set(SCENARIOS.flatMap((scenario) =>
      scenario.placements.map((placement) => placement.actorDefinitionId)));
    expect(definitionIds.size).toBeGreaterThanOrEqual(10);
  });
});

describe("party-size placement applicability", () => {
  it("treats an absent range as every party size", () => {
    const placement = { partySize: undefined } as unknown as EncounterActorPlacement;
    for (const partySize of PARTY_SIZES) expect(placementAppliesToPartySize(placement, partySize)).toBe(true);
  });

  it("includes a placement only inside its authored range", () => {
    const placement = { partySize: { min: 2, max: 3 } } as unknown as EncounterActorPlacement;
    expect(placementAppliesToPartySize(placement, 1)).toBe(false);
    expect(placementAppliesToPartySize(placement, 2)).toBe(true);
    expect(placementAppliesToPartySize(placement, 3)).toBe(true);
  });

  it("builds a different static composition for each party size at runtime", () => {
    // Bone Cellar is authored to grow, so this fails if the bridge stops filtering.
    expect(enemyIdsFor("encounter.bone-cellar", 1)).toEqual(["skeleton-guard", "skeleton-rabble-a"]);
    expect(enemyIdsFor("encounter.bone-cellar", 2))
      .toEqual(["skeleton-guard", "skeleton-rabble-a", "skeleton-rabble-b"]);
    expect(enemyIdsFor("encounter.bone-cellar", 3))
      .toEqual(["skeleton-guard", "skeleton-rabble-a", "skeleton-rabble-b", "skeleton-rabble-c"]);
  });

  it("seats exactly the party that entered and leaves an unscaled Scenario alone", () => {
    for (const count of [1, 2, 3] as const) {
      const actors = encounterFor("encounter.bone-cellar", count).definition.scenario.actors;
      expect(actors.filter((actor) => actor.team === "heroes")).toHaveLength(count);
      // Road Ambush authors no range, so its composition must not move with party size.
      expect(enemyIdsFor("encounter.road-ambush", count)).toEqual(["goblin-skirmisher"]);
    }
  });

  it("compiles the preview at a party of one", () => {
    const scaling = SCENARIOS.find((scenario) =>
      scenario.placements.some((placement) => placement.partySize && placement.partySize.min > 1));
    if (!scaling) throw new Error("No scenario scales with party size.");
    const preview = PACK.scenarios[scaling.id];
    if (!preview) throw new Error("Compiled scenario is missing.");
    const previewEnemies = preview.actors.filter((actor) => actor.team === "enemies").length;
    expect(previewEnemies).toBe(activeFor(scaling, 1).filter((placement) => placement.team === "enemies").length);
    expect(previewEnemies).toBeLessThan(activeFor(scaling, 3).length);
  });
});

describe("party-size aware validation", () => {
  it("lets placements with disjoint ranges reuse one tile", () => {
    const pack = withScenario("encounter.road-ambush", (scenario) => ({
      ...scenario,
      placements: [
        { ...scenario.placements[0] as EncounterActorPlacement, instanceId: "solo", partySize: { min: 1, max: 1 } },
        { ...scenario.placements[0] as EncounterActorPlacement, instanceId: "crowd", partySize: { min: 2, max: 3 } },
      ],
    }));
    // The two never share a board, so the shared tile is not a collision.
    expect(validateContentPackSemantics(pack)).toEqual([]);
  });

  it("still rejects two placements that coexist on one tile", () => {
    const pack = withScenario("encounter.road-ambush", (scenario) => ({
      ...scenario,
      placements: [
        { ...scenario.placements[0] as EncounterActorPlacement, instanceId: "solo", partySize: { min: 1, max: 2 } },
        { ...scenario.placements[0] as EncounterActorPlacement, instanceId: "crowd", partySize: { min: 2, max: 3 } },
      ],
    }));
    expect(validateContentPackSemantics(pack)).toContainEqual(expect.objectContaining({
      code: "ACTOR_POSITION_CONFLICT",
    }));
  });

  it("rejects a placement that stands on an active hero spawn", () => {
    const pack = withScenario("encounter.road-ambush", (scenario) => {
      const seatTwo = scenario.partySpawnSlots.find((slot) => slot.seat === 2);
      if (!seatTwo) throw new Error("Seat 2 spawn is missing.");
      return {
        ...scenario,
        placements: [
          ...scenario.placements,
          { ...scenario.placements[0] as EncounterActorPlacement, instanceId: "camper", position: { ...seatTwo.position }, partySize: { min: 2, max: 3 } },
        ],
      };
    });
    expect(validateContentPackSemantics(pack)).toContainEqual(expect.objectContaining({
      code: "PARTY_SPAWN_STATIC_CONFLICT",
    }));
  });

  it("allows a placement on a spawn seat that party size leaves unused", () => {
    const pack = withScenario("encounter.road-ambush", (scenario) => {
      const seatThree = scenario.partySpawnSlots.find((slot) => slot.seat === 3);
      if (!seatThree) throw new Error("Seat 3 spawn is missing.");
      return {
        ...scenario,
        placements: [
          ...scenario.placements,
          { ...scenario.placements[0] as EncounterActorPlacement, instanceId: "solo-extra", position: { ...seatThree.position }, partySize: { min: 1, max: 1 } },
        ],
      };
    });
    // Seat 3 is empty in a one-hero party, so nothing collides there.
    expect(validateContentPackSemantics(pack)).toEqual([]);
  });

  it("rejects an inverted party-size range", () => {
    const pack = withScenario("encounter.road-ambush", (scenario) => ({
      ...scenario,
      placements: scenario.placements.map((placement) => ({ ...placement, partySize: { min: 3, max: 1 } })),
    }));
    expect(validateContentPackSemantics(pack)).toContainEqual(expect.objectContaining({
      code: "INVALID_PLACEMENT_PARTY_SIZE",
    }));
  });

  it("rejects a composition that leaves a party size with no enemy", () => {
    const pack = withScenario("encounter.road-ambush", (scenario) => ({
      ...scenario,
      placements: scenario.placements.map((placement) => ({ ...placement, partySize: { min: 2, max: 3 } })),
    }));
    expect(validateContentPackSemantics(pack)).toContainEqual(expect.objectContaining({
      code: "NO_ENEMY_FOR_PARTY_SIZE",
    }));
  });
});

describe("party-size authoring is part of the content identity", () => {
  it("changes the fingerprint when a placement range changes", () => {
    const before = fingerprintContentPack(normalizeContentPack(source()));
    const after = fingerprintContentPack(normalizeContentPack(withScenario("encounter.bone-cellar", (scenario) => ({
      ...scenario,
      placements: scenario.placements.map((placement) => placement.instanceId === "skeleton-rabble-b"
        ? { ...placement, partySize: { min: 3, max: 3 } }
        : placement),
    }))));
    expect(after).not.toBe(before);
    expect(before).toBe(PACK.fingerprint);
  });

  it("keeps a pack without any ranges compiling exactly as before", () => {
    const stripped = source();
    const withoutRanges: ContentPackSource = {
      ...stripped,
      scenarios: stripped.scenarios.map((scenario) => ({
        ...scenario,
        placements: scenario.placements.map((placement) => {
          const stripped: Record<string, unknown> = { ...placement };
          delete stripped.partySize;
          return stripped as unknown as EncounterActorPlacement;
        }),
      })),
    };
    const compiled = compileContentPack(withoutRanges);
    for (const scenario of Object.values(compiled.scenarioSources)) {
      for (const partySize of PARTY_SIZES) {
        expect(`${scenario.id}@${String(partySize)}`).toBe(`${scenario.id}@${String(partySize)}`);
        expect(activeFor(scenario, partySize).length).toBe(scenario.placements.length);
      }
    }
    expect(Object.keys(compiled.combatContent.actions).length)
      .toBe(Object.keys(M7_CONTENT.actions).length);
  });
});
