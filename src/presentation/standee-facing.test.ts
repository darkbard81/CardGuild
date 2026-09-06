import { describe, expect, it } from "vitest";

import { facingStandee } from "./presentation-types";

const AERIN = { front: "actor.hero.aerin.front", back: "actor.hero.aerin.back" };

describe("standee facing", () => {
  it("turns its back only for north", () => {
    expect(facingStandee(AERIN, "north")).toEqual({ assetId: AERIN.back, flipX: false });
    for (const direction of ["south", "east", "west"] as const) {
      expect(facingStandee(AERIN, direction).assetId).toBe(AERIN.front);
    }
  });

  it("mirrors west and leaves the authored east pose alone", () => {
    expect(facingStandee(AERIN, "east").flipX).toBe(false);
    expect(facingStandee(AERIN, "west").flipX).toBe(true);
    // South is the pose the art was drawn as, so it is never mirrored either.
    expect(facingStandee(AERIN, "south").flipX).toBe(false);
    expect(facingStandee(AERIN, "north").flipX).toBe(false);
  });
});
