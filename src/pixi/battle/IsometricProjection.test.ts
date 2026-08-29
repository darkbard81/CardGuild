import { describe, expect, it } from "vitest";

import { gridToIso, isoToGrid, M2_ISOMETRIC_METRICS } from "./IsometricProjection";

describe("IsometricProjection", () => {
  it("uses the 64x32 M2 logical footprint", () => {
    expect(M2_ISOMETRIC_METRICS).toEqual({ tileWidth: 64, tileHeight: 32 });
    expect(gridToIso({ x: 3, y: 1 })).toEqual({ x: 64, y: 64 });
  });

  it("round-trips tile centers and resolves shared edges deterministically", () => {
    for (let y = 0; y < 5; y += 1) {
      for (let x = 0; x < 5; x += 1) expect(isoToGrid(gridToIso({ x, y }))).toEqual({ x, y });
    }
    expect(isoToGrid({ x: 16, y: 8 })).toEqual({ x: 0, y: 0 });
  });
});
