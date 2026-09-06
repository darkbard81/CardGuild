import { describe, expect, it } from "vitest";

import {
  assertRequiredTileVisuals,
  assertTileVisualContract,
  TILE_SOURCE_SIZE,
} from "./tile-visual-contract";
import type { PresentationAssetDefinition } from "./presentation-types";

const CANVAS = { width: TILE_SOURCE_SIZE, height: TILE_SOURCE_SIZE };
const GATE: PresentationAssetDefinition = {
  frame: "terrain.gate.closed",
  kind: "terrain",
  anchor: { x: 0.5, y: 0.5 },
  displayWidth: 128,
  displayHeight: 128,
  footprint: { width: 128, height: 128 },
};

describe("tile visual contract", () => {
  it("accepts a square terrain tile and names the first thing wrong with anything else", () => {
    expect(() => assertTileVisualContract("terrain.gate.closed", GATE, CANVAS)).not.toThrow();
    // A gate used to be an upright object on a bottom-centre anchor. Both are now refused.
    expect(() => assertTileVisualContract("x", { ...GATE, kind: "object" }, CANVAS)).toThrow(/must be terrain/);
    expect(() => assertTileVisualContract("x", { ...GATE, anchor: { x: 0.5, y: 1 } }, CANVAS))
      .toThrow(/centred anchor/);
    expect(() => assertTileVisualContract("x", { ...GATE, displayHeight: undefined }, CANVAS))
      .toThrow(/drawn 128x128/);
    expect(() => assertTileVisualContract("x", { ...GATE, footprint: undefined }, CANVAS))
      .toThrow(/must claim one 128x128 cell/);
    // A gate's two states share the wall's alignment, so a tall canvas is a real bug.
    expect(() => assertTileVisualContract("x", GATE, { width: 256, height: 344 }))
      .toThrow(/256px square canvas/);
  });

  it("insists every tile state has a picture, both halves of the gate included", () => {
    const visuals = {
      open: "terrain.stone-floor",
      difficult: "terrain.rubble",
      impassable: "terrain.chasm",
      web: "transition.web",
      blocked: "terrain.wall-block",
      gateClosed: "terrain.gate.closed",
      gateOpen: "terrain.gate.open",
    };
    const validated = new Set(Object.values(visuals));
    expect(() => assertRequiredTileVisuals(visuals, validated)).not.toThrow();
    expect(() => assertRequiredTileVisuals({ ...visuals, gateOpen: "" }, validated))
      .toThrow(/"gateOpen" is missing/);
    // A gate state that fell out of the terrain path must fail, not be waved through.
    validated.delete("terrain.gate.open");
    expect(() => assertRequiredTileVisuals(visuals, validated))
      .toThrow(/"gateOpen" must be a board tile visual/);
  });
});
