import { describe, expect, it } from "vitest";

import {
  findPath,
  findReachableTiles,
  hasLineOfEffect,
  hasLineOfSight,
  positionKey,
} from "./grid";
import type { ActorState, BattleMapState, TileState, TraitInstance } from "./types";

const trait = (id: string): TraitInstance => ({ id });

function mapWith(overrides: Readonly<Record<string, readonly TraitInstance[]>> = {}): BattleMapState {
  const tiles: Record<string, TileState> = {};
  for (let y = 0; y < 4; y += 1) {
    for (let x = 0; x < 4; x += 1) {
      const position = { x, y };
      const key = positionKey(position);
      tiles[key] = { id: `tile-${key}`, position, traits: overrides[key] ?? [trait("open")] };
    }
  }
  return { width: 4, height: 4, tiles, objects: {} };
}

function corridorWith(overrides: Readonly<Record<string, readonly TraitInstance[]>> = {}): BattleMapState {
  return { ...mapWith(overrides), height: 1 };
}

const actor: ActorState = {
  id: "actor",
  definitionId: "test.actor",
  name: "Actor",
  team: "heroes",
  position: { x: 0, y: 0 },
  facing: "east",
  hp: 10,
  maxHp: 10,
  statProfile: {
    kind: "creature",
    stats: {
      ac: 10,
      maxHp: 10,
      strike: {
        name: "Test",
        attackModifier: 0,
        rangeFeet: 5,
        damage: { count: 1, sides: 4, modifier: 0, damageType: "bludgeoning" },
        traits: [],
      },
      perception: 0,
      saves: { fortitude: 0, reflex: 0, will: 0 },
      skills: { athletics: 0 },
    },
  },
  speedFeet: 25,
  conditions: [],
  traits: [],
  equipmentIds: [],
  innateActionIds: [],
  deckContributions: [],
  reactionAvailable: true,
  shieldRaised: false,
  defeated: false,
};

describe("orthogonal grid rules", () => {
  it("never reaches a diagonal tile with one 5ft step", () => {
    const reachable = findReachableTiles(mapWith(), { actor }, actor.id, actor.position, 5, "land");
    expect([...reachable.keys()]).toEqual(["1,0", "0,1"]);
    expect(reachable.has("1,1")).toBe(false);
  });

  it("applies difficult, impassable, blocked, and fly movement independently", () => {
    const map = mapWith({
      "1,0": [trait("open"), trait("difficult")],
      "0,1": [trait("impassable")],
      "1,1": [trait("blocked")],
    });
    expect(findPath(map, { actor }, actor.id, actor.position, { x: 1, y: 0 }, 5, "land")).toBeNull();
    expect(findPath(map, { actor }, actor.id, actor.position, { x: 1, y: 0 }, 10, "land")?.cost).toBe(10);
    expect(findPath(map, { actor }, actor.id, actor.position, { x: 0, y: 1 }, 5, "land")).toBeNull();
    expect(findPath(map, { actor }, actor.id, actor.position, { x: 0, y: 1 }, 5, "fly")?.cost).toBe(5);
    expect(findPath(map, { actor }, actor.id, actor.position, { x: 1, y: 1 }, 20, "fly")).toBeNull();
  });

  it("uses a deterministic path and conservative corner tie rule", () => {
    const openMap = mapWith();
    const first = findPath(openMap, { actor }, actor.id, actor.position, { x: 2, y: 2 }, 20, "land");
    const second = findPath(openMap, { actor }, actor.id, actor.position, { x: 2, y: 2 }, 20, "land");
    expect(first).toEqual(second);

    const cornerBlocked = mapWith({ "1,0": [trait("blocked")] });
    expect(hasLineOfSight(cornerBlocked, { x: 0, y: 0 }, { x: 2, y: 2 })).toBe(false);
    expect(hasLineOfEffect(cornerBlocked, { x: 0, y: 0 }, { x: 2, y: 2 })).toBe(false);

    const impassable = mapWith({ "1,1": [trait("impassable")] });
    expect(hasLineOfSight(impassable, { x: 0, y: 0 }, { x: 2, y: 2 })).toBe(true);
  });
});

describe("movement occupancy", () => {
  it.each([
    ["heroes", "land"],
    ["heroes", "fly"],
    ["enemies", "land"],
    ["enemies", "fly"],
  ] as const)("lets %s traverse allies by %s without stopping on them", (team, mode) => {
    const mover = { ...actor, team };
    const ally = { ...mover, id: "ally", position: { x: 1, y: 0 } };
    const nextAlly = { ...mover, id: "next-ally", position: { x: 2, y: 0 } };
    const actors = { [mover.id]: mover, [ally.id]: ally, [nextAlly.id]: nextAlly };
    const map = corridorWith();
    const destination = { x: 3, y: 0 };

    const reachable = findReachableTiles(map, actors, mover.id, mover.position, 15, mode);
    expect([...reachable.keys()]).toEqual(["3,0"]);
    expect(findPath(map, actors, mover.id, mover.position, destination, 15, mode)).toEqual({
      position: destination,
      cost: 15,
      path: [ally.position, nextAlly.position, destination],
    });
    expect(findPath(map, actors, mover.id, mover.position, ally.position, 15, mode)).toBeNull();
    expect(findPath(map, actors, mover.id, mover.position, nextAlly.position, 15, mode)).toBeNull();
    expect(findReachableTiles(map, actors, mover.id, mover.position, 5, mode).size).toBe(0);
    expect(findReachableTiles(map, actors, mover.id, mover.position, 10, mode).size).toBe(0);
  });

  it.each([
    ["heroes", "enemies", "land"],
    ["heroes", "enemies", "fly"],
    ["enemies", "heroes", "land"],
    ["enemies", "heroes", "fly"],
  ] as const)("blocks %s from traversing or stopping on %s by %s", (team, opposingTeam, mode) => {
    const mover = { ...actor, team };
    const enemy = { ...actor, id: "enemy", team: opposingTeam, position: { x: 1, y: 0 } };
    const actors = { [mover.id]: mover, [enemy.id]: enemy };
    const map = corridorWith();

    expect(findReachableTiles(map, actors, mover.id, mover.position, 25, mode).size).toBe(0);
    expect(findPath(map, actors, mover.id, mover.position, enemy.position, 25, mode)).toBeNull();
    expect(findPath(map, actors, mover.id, mover.position, { x: 2, y: 0 }, 25, mode)).toBeNull();
  });

  it.each(["heroes", "enemies"] as const)("ignores defeated %s for traversal and stopping", (team) => {
    const defeated = { ...actor, id: "defeated", team, defeated: true, hp: 0, position: { x: 1, y: 0 } };
    const actors = { actor, [defeated.id]: defeated };
    const map = corridorWith();

    expect(findPath(map, actors, actor.id, actor.position, defeated.position, 5, "land")?.cost).toBe(5);
    expect(findPath(map, actors, actor.id, actor.position, { x: 2, y: 0 }, 10, "land")?.path)
      .toEqual([defeated.position, { x: 2, y: 0 }]);
  });

  it("ignores the mover itself when checking occupancy", () => {
    // A path query may start from a hypothetical position before the actor is moved.
    const from = { x: 2, y: 0 };
    expect(findPath(corridorWith(), { actor }, actor.id, from, actor.position, 10, "land")?.path)
      .toEqual([{ x: 1, y: 0 }, actor.position]);
  });

  it("keeps an enemy blocking even when an ally shares its square", () => {
    const ally = { ...actor, id: "ally", position: { x: 1, y: 0 } };
    const enemy = { ...ally, id: "enemy", team: "enemies" as const };
    const actors = { actor, ally, enemy };
    expect(findReachableTiles(corridorWith(), actors, actor.id, actor.position, 25, "land").size).toBe(0);
  });

  it.each([
    ["difficult", "land", 15],
    ["difficult", "fly", 10],
    ["impassable", "land", null],
    ["impassable", "fly", 10],
    ["blocked", "land", null],
    ["blocked", "fly", null],
  ] as const)("preserves %s terrain rules while traversing an ally by %s", (terrain, mode, cost) => {
    const ally = { ...actor, id: "ally", position: { x: 1, y: 0 } };
    const actors = { actor, ally };
    const map = corridorWith({ "1,0": [trait(terrain)] });
    const destination = { x: 2, y: 0 };
    const path = findPath(map, actors, actor.id, actor.position, destination, 15, mode);

    if (cost === null) {
      expect(path).toBeNull();
    } else {
      expect(path).toEqual({ position: destination, cost, path: [ally.position, destination] });
      expect(findPath(map, actors, actor.id, actor.position, destination, cost - 5, mode)).toBeNull();
    }
  });
});
