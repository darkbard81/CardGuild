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

const actor: ActorState = {
  id: "actor",
  definitionId: "test.actor",
  name: "Actor",
  team: "heroes",
  position: { x: 0, y: 0 },
  facing: "east",
  hp: 10,
  maxHp: 10,
  baseAc: 10,
  reflexModifier: 0,
  athleticsModifier: 0,
  initiativeModifier: 0,
  speedFeet: 25,
  fallbackWeapon: {
    name: "Test",
    attackModifier: 0,
    rangeFeet: 5,
    damage: { count: 1, sides: 4, modifier: 0, damageType: "bludgeoning" },
  },
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
