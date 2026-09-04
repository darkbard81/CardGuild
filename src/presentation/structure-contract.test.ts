import { describe, expect, it } from "vitest";

import type { PresentationAssetDefinition } from "./presentation-types";
import {
  assertGatePair,
  assertPointPropContract,
  assertStructureContract,
  isTileStructure,
  spriteSizing,
  type StructureFrame,
} from "./structure-contract";

const WALL: PresentationAssetDefinition = {
  frame: "object.wall",
  kind: "object",
  anchor: { x: 0.5, y: 1 },
  displayWidth: 128,
  footprint: { width: 128, height: 128 },
};

const CHEST: PresentationAssetDefinition = {
  frame: "object.chest",
  kind: "object",
  anchor: { x: 0.5, y: 1 },
  displayHeight: 92,
};

/** A structure drawn 256 wide, standing on the bottom of a 112-tall canvas. */
const WALL_FRAME: StructureFrame = {
  canvas: { width: 256, height: 112 },
  ink: { left: 0, top: 9, width: 256, height: 103 },
};

const TALL_FRAME: StructureFrame = {
  canvas: { width: 256, height: 344 },
  ink: { left: 0, top: 6, width: 256, height: 338 },
};

describe("tile-bound structure contract", () => {
  it("tells a structure from a point prop by what it declares, not what it is called", () => {
    expect(isTileStructure(WALL)).toBe(true);
    expect(isTileStructure(CHEST)).toBe(false);
  });

  it("accepts a structure that owns exactly one cell", () => {
    expect(() => assertStructureContract("object.wall", WALL, WALL_FRAME)).not.toThrow();
    // Height is free: a taller silhouette is still one cell wide.
    expect(() => assertStructureContract("object.gate.closed", WALL, TALL_FRAME)).not.toThrow();
  });

  it("refuses a structure that is not one cell wide", () => {
    expect(() => assertStructureContract("wide", { ...WALL, displayWidth: 192 }, WALL_FRAME))
      .toThrow(/128px display width/);
    expect(() => assertStructureContract("half", WALL, {
      ...WALL_FRAME,
      ink: { left: 20, top: 9, width: 216, height: 103 },
    })).toThrow(/span its canvas width/);
    expect(() => assertStructureContract("small", WALL, {
      canvas: { width: 192, height: 112 },
      ink: { left: 0, top: 9, width: 192, height: 103 },
    })).toThrow(/256px canvas width/);
  });

  it("refuses a structure without the one-cell footprint or the bottom-centre anchor", () => {
    expect(() => assertStructureContract("no-footprint", { ...WALL, footprint: undefined }, WALL_FRAME))
      .toThrow(/one 128x128 cell/);
    expect(() => assertStructureContract("wrong-footprint", {
      ...WALL,
      footprint: { width: 256, height: 128 },
    }, WALL_FRAME)).toThrow(/one 128x128 cell/);
    expect(() => assertStructureContract("floating", { ...WALL, anchor: { x: 0.5, y: 0.5 } }, WALL_FRAME))
      .toThrow(/bottom-centre anchor/);
  });

  it("refuses a structure that authors a height or floats above its baseline", () => {
    expect(() => assertStructureContract("tall", { ...WALL, displayHeight: 108 }, WALL_FRAME))
      .toThrow(/must not author a display height/);
    expect(() => assertStructureContract("hovering", WALL, {
      ...WALL_FRAME,
      ink: { left: 0, top: 4, width: 256, height: 80 },
    })).toThrow(/stand on the bottom/);
  });

  it("refuses an empty structure frame", () => {
    expect(() => assertStructureContract("blank", WALL, { canvas: { width: 256, height: 112 }, ink: null }))
      .toThrow(/span its canvas width/);
  });

  it("leaves point props on their authored height", () => {
    expect(() => assertPointPropContract("object.chest", CHEST)).not.toThrow();
    expect(() => assertPointPropContract("object.chest", { ...CHEST, displayHeight: undefined }))
      .toThrow(/must author the display height/);
  });

  it("keeps a gate's two states on the same frame", () => {
    const closed: StructureFrame = TALL_FRAME;
    expect(() => assertGatePair(closed, { ...closed, ink: { left: 0, top: 7, width: 256, height: 337 } }))
      .not.toThrow();
    expect(() => assertGatePair(closed, { ...closed, canvas: { width: 256, height: 300 } }))
      .toThrow(/share one canvas/);
    // An open gate that grew or slid up would make the board jump on the swap.
    expect(() => assertGatePair(closed, { ...closed, ink: { left: 0, top: 30, width: 256, height: 314 } }))
      .toThrow(/keep the same bounds/);
  });

  it("sizes a structure by width and a prop by height", () => {
    expect(spriteSizing(WALL, 96)).toEqual({ axis: "width", value: 128 });
    expect(spriteSizing(CHEST, 96)).toEqual({ axis: "height", value: 92 });
    expect(spriteSizing({ ...CHEST, displayHeight: undefined }, 96)).toEqual({ axis: "height", value: 96 });
  });
});
