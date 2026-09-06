import { describe, expect, it } from "vitest";

import { tileStateVisual } from "./TerrainRenderer";

const VISUALS = {
  open: "terrain.stone-floor",
  difficult: "terrain.rubble",
  impassable: "terrain.chasm",
  web: "transition.web",
  blocked: "terrain.wall-block",
  gateClosed: "terrain.gate.closed",
  gateOpen: "terrain.gate.open",
};

const surfaceOf = (...traits: readonly string[]): string | null => tileStateVisual(new Set(traits), VISUALS);

describe("tile state surface", () => {
  it("leaves ordinary ground to its floor", () => {
    expect(surfaceOf()).toBeNull();
    expect(surfaceOf("difficult")).toBeNull();
    expect(surfaceOf("web")).toBeNull();
    // Impassable ground is a hole in the floor, not a barrier standing on it.
    expect(surfaceOf("impassable")).toBeNull();
  });

  it("paves a blocked tile with wall", () => {
    expect(surfaceOf("blocked")).toBe(VISUALS.blocked);
  });

  it("gives a gate its own surface in both states, ahead of the wall", () => {
    // A shut gate is blocked too, so the gate has to be asked about first or the wall
    // would pave over the door.
    expect(surfaceOf("blocked", "gate")).toBe(VISUALS.gateClosed);
    // An open gate is no longer blocked, and never shows the closed picture.
    expect(surfaceOf("open", "gate-open")).toBe(VISUALS.gateOpen);
    expect(surfaceOf("open", "gate-open")).not.toBe(VISUALS.gateClosed);
  });

  it("opens a gate by nothing more than the traits the rules already moved", () => {
    // The lever removes blocked + gate and adds open + gate-open. That is the whole of
    // "the gate opens" as far as the board is concerned: one different tile picture.
    const shut = surfaceOf("blocked", "gate");
    const opened = surfaceOf("open", "gate-open");
    expect(shut).not.toBe(opened);
  });
});
