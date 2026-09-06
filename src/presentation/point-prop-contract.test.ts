import { describe, expect, it } from "vitest";

import {
  assertPointPropContract,
  assertPointPropFramePlan,
  pointPropHeight,
  type FramePlanShape,
} from "./point-prop-contract";
import type { PresentationAssetDefinition } from "./presentation-types";

const LEVER: PresentationAssetDefinition = {
  frame: "object.lever",
  kind: "object",
  anchor: { x: 0.5, y: 1 },
  displayHeight: 88,
};

describe("point prop contract", () => {
  it("insists a prop authors the height it is drawn at", () => {
    expect(() => assertPointPropContract("object.lever", LEVER)).not.toThrow();
    expect(() => assertPointPropContract("object.lever", { ...LEVER, displayHeight: undefined }))
      .toThrow(/must author the display height/);
  });

  it("draws a prop at its authored height, falling back only when it has none", () => {
    expect(pointPropHeight(LEVER, 96)).toBe(88);
    expect(pointPropHeight({ ...LEVER, displayHeight: undefined }, 96)).toBe(96);
  });

  it("checks the plan side of the same contract", () => {
    const plan: FramePlanShape = {
      assetId: "object.crate",
      kind: "object",
      anchor: { x: 0.5, y: 1 },
      displaySize: { height: 92 },
    };
    expect(() => assertPointPropFramePlan(plan)).not.toThrow();
    expect(() => assertPointPropFramePlan({ ...plan, kind: "terrain" })).toThrow(/must be an object/);
    expect(() => assertPointPropFramePlan({ ...plan, displaySize: {} })).toThrow(/must author the height/);
    // A width on a height-driven prop is a declaration the runtime never reads.
    expect(() => assertPointPropFramePlan({ ...plan, displaySize: { width: 96, height: 92 } }))
      .toThrow(/a width is never read/);
  });

  it("sends anything that claims a whole cell to the terrain path instead", () => {
    // A wall and a gate are the tile's own state, so they are square terrain sources.
    // A prop that declares a footprint is asking to be one and has to say so.
    const plan: FramePlanShape = {
      assetId: "object.gate.closed",
      kind: "object",
      anchor: { x: 0.5, y: 1 },
      displaySize: { height: 92 },
      footprint: { width: 128, height: 128 },
    };
    expect(() => assertPointPropFramePlan(plan)).toThrow(/a terrain source, not an object/);
  });
});
