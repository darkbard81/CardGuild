import { describe, expect, it } from "vitest";

import { createPresentationCatalog } from "./asset-catalog";
import { tilemapAssetAt } from "./tilemap";

describe("M2 presentation tilemaps", () => {
  it("separates ground, transition, and object placement layers", () => {
    const map = createPresentationCatalog().tilemap("encounter.ruined-gate");
    const at = (x: number, y: number): number => y * map.width + x;

    expect(tilemapAssetAt(map, "ground", at(2, 2))).toBe("terrain.rubble");
    expect(tilemapAssetAt(map, "ground", at(3, 4))).toBe("terrain.chasm");
    expect(tilemapAssetAt(map, "transitions", at(5, 3))).toBe("transition.web");
    expect(tilemapAssetAt(map, "objects", at(4, 3))).toBe("object.gate.closed");
    expect(tilemapAssetAt(map, "objects", at(1, 2))).toBe("object.lever");
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
});
