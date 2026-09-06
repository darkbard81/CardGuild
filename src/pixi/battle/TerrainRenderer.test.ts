import { describe, expect, it } from "vitest";

import { gateStateOf, tileStateVisual } from "./TerrainRenderer";

const VISUALS = {
  open: "terrain.stone-floor",
  difficult: "terrain.rubble",
  impassable: "terrain.chasm",
  web: "transition.web",
  blocked: "terrain.wall-block",
};

const surfaceOf = (...traits: readonly string[]): string | null => tileStateVisual(new Set(traits), VISUALS);
const gateOf = (...traits: readonly string[]): string | null => gateStateOf(new Set(traits));

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

  it("gives a shut gate the wall's own surface, with the door drawn on top", () => {
    // A gate has no texture of its own. Shut, it is a wall square; open, it is whatever
    // ground was already there. The door is Graphics either way, so a gate anywhere on
    // any map costs no art.
    expect(surfaceOf("blocked", "gate")).toBe(VISUALS.blocked);
    expect(surfaceOf("open", "gate-open")).toBeNull();
  });
});

describe("gate state", () => {
  it("reads the traits the lever already moved", () => {
    expect(gateOf("blocked", "gate")).toBe("closed");
    expect(gateOf("open", "gate-open")).toBe("open");
    expect(gateOf("blocked")).toBeNull();
    expect(gateOf()).toBeNull();
  });

  it("prefers the open trait, because an open gate is no longer blocked", () => {
    // The rules drop blocked/gate and add open/gate-open together, but reading the open
    // state first means a half-applied set can never draw a shut door on a passable tile.
    expect(gateOf("gate", "gate-open")).toBe("open");
  });
});
