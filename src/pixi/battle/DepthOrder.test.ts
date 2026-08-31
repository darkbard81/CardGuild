import { describe, expect, it } from "vitest";

import { compareDepth, type DepthKey } from "./DepthOrder";

describe("projected depth order", () => {
  it("sorts by screen Y, layer priority, then stable ID", () => {
    const values: DepthKey[] = [
      { screenY: 420, layerPriority: 30, stableId: "b" },
      { screenY: 260, layerPriority: 30, stableId: "z" },
      { screenY: 420, layerPriority: 20, stableId: "z" },
      { screenY: 420, layerPriority: 30, stableId: "a" },
    ];
    expect(values.sort(compareDepth).map((value) => value.stableId)).toEqual(["z", "z", "a", "b"]);
  });
});
