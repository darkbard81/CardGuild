import { describe, expect, it } from "vitest";

import {
  assertRequiredTileVisuals,
  assertTileVisualContract,
  TILE_SOURCE_SIZE,
} from "./tile-visual-contract";
import type { PresentationAssetDefinition } from "./presentation-types";

const CANVAS = { width: TILE_SOURCE_SIZE, height: TILE_SOURCE_SIZE };
const WALL: PresentationAssetDefinition = {
  frame: "terrain.wall-block",
  kind: "terrain",
  anchor: { x: 0.5, y: 0.5 },
  displayWidth: 128,
  displayHeight: 128,
  footprint: { width: 128, height: 128 },
};

describe("tile visual contract", () => {
  it("accepts a square terrain tile and names the first thing wrong with anything else", () => {
    expect(() => assertTileVisualContract("terrain.wall-block", WALL, CANVAS)).not.toThrow();
    // A tile visual used to have an upright cousin on a bottom-centre anchor. Both refused.
    expect(() => assertTileVisualContract("x", { ...WALL, kind: "object" }, CANVAS)).toThrow(/must be terrain/);
    expect(() => assertTileVisualContract("x", { ...WALL, anchor: { x: 0.5, y: 1 } }, CANVAS))
      .toThrow(/centred anchor/);
    expect(() => assertTileVisualContract("x", { ...WALL, displayHeight: undefined }, CANVAS))
      .toThrow(/drawn 128x128/);
    expect(() => assertTileVisualContract("x", { ...WALL, footprint: undefined }, CANVAS))
      .toThrow(/must claim one 128x128 cell/);
    // A tile has to be square: a tall canvas would stretch across the cell it fills.
    expect(() => assertTileVisualContract("x", WALL, { width: 256, height: 344 }))
      .toThrow(/256px square canvas/);
  });

  it("insists every surface a square can be composited with has a picture", () => {
    const visuals = {
      open: "terrain.stone-floor",
      difficult: "terrain.rubble",
      impassable: "terrain.chasm",
      web: "transition.web",
      blocked: "terrain.wall-block",
    };
    const validated = new Set(Object.values(visuals));
    expect(() => assertRequiredTileVisuals(visuals, validated)).not.toThrow();
    expect(() => assertRequiredTileVisuals({ ...visuals, blocked: "" }, validated))
      .toThrow(/"blocked" is missing/);
    // A surface that fell out of the terrain path must fail, not be waved through.
    validated.delete("terrain.wall-block");
    expect(() => assertRequiredTileVisuals(visuals, validated))
      .toThrow(/"blocked" must be a board tile visual/);
    // A gate is drawn on top of one of these, so it is not required to be one.
    expect(() => assertRequiredTileVisuals({ ...visuals, gateClosed: "" }, validated.add("terrain.wall-block")))
      .not.toThrow();
  });
});
