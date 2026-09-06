import { describe, expect, it } from "vitest";

import { createPresentationCatalog } from "./asset-catalog";
import { tilemapAssetAt } from "./tilemap";

describe("M3 presentation tilemaps", () => {
  it("separates ground, transition, and object placement layers", () => {
    const map = createPresentationCatalog().tilemap("encounter.ruined-gate");
    const at = (x: number, y: number): number => y * map.width + x;

    expect(tilemapAssetAt(map, "ground", at(2, 2))).toBe("terrain.rubble");
    expect(tilemapAssetAt(map, "ground", at(3, 4))).toBe("terrain.chasm");
    expect(tilemapAssetAt(map, "transitions", at(5, 3))).toBe("transition.web");
    // The object layer carries point props only. A gate is the state of its tile, so the
    // board reads it from the tile's traits at runtime and it takes no slot here.
    expect(tilemapAssetAt(map, "objects", at(4, 3))).toBeNull();
    expect(map.palettes.objects).not.toContain("terrain.gate.closed");
    expect(tilemapAssetAt(map, "objects", at(1, 2))).toBe("object.lever");
    expect(tilemapAssetAt(map, "objects", at(2, 2))).toBe("object.chest");
    expect(tilemapAssetAt(map, "objects", at(2, 3))).toBe("object.chest");
    expect(tilemapAssetAt(map, "transitions", at(0, 0))).toBeNull();
  });

  it("keeps gameplay metadata aligned with row-major layer indices", () => {
    const map = createPresentationCatalog().tilemap("encounter.road-ambush");
    expect(map.layers.ground).toHaveLength(map.width * map.height);
    expect(map.meta.tileIds[1]).toBe("road-1,0");
    expect(map.meta.type[1]).toBe("difficult");
    expect(map.meta.walkable[1]).toBe(true);
    expect(map.meta.cost[1]).toBe(2);
  });

  it("keeps the gate's gameplay semantics in the metadata it always had", () => {
    // Moving the gate off the object layer is a presentation change: the tile is still a
    // gate, still unwalkable, and still costs nothing to enter because nobody can.
    const map = createPresentationCatalog().tilemap("encounter.ruined-gate");
    const gate = 3 * map.width + 4;
    expect(map.meta.type[gate]).toBe("gate");
    expect(map.meta.walkable[gate]).toBe(false);
    expect(map.meta.cost[gate]).toBeNull();
  });
});
