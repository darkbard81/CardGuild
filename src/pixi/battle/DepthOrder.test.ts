import { describe, expect, it } from "vitest";

import { compareDepth, type DepthKey } from "./DepthOrder";

describe("isometric depth order", () => {
  it("sorts by x+y, layer priority, then stable ID", () => {
    const values: DepthKey[] = [
      { position: { x: 1, y: 1 }, layerPriority: 30, stableId: "b" },
      { position: { x: 0, y: 1 }, layerPriority: 30, stableId: "z" },
      { position: { x: 1, y: 1 }, layerPriority: 20, stableId: "z" },
      { position: { x: 1, y: 1 }, layerPriority: 30, stableId: "a" },
    ];
    expect(values.sort(compareDepth).map((value) => value.stableId)).toEqual(["z", "z", "a", "b"]);
  });
});
