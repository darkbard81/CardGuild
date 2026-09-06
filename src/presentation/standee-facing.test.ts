import { describe, expect, it } from "vitest";

import { facingStandee } from "./presentation-types";

const AERIN = { front: "actor.hero.aerin.front", back: "actor.hero.aerin.back" };

describe("standee facing", () => {
  it("turns its back for the two directions that lead away from the player", () => {
    // A quarter turn puts north up-right and west up-left: both walk away, so both show
    // the back. East and south come down the screen towards the player.
    expect(facingStandee(AERIN, "north").assetId).toBe(AERIN.back);
    expect(facingStandee(AERIN, "west").assetId).toBe(AERIN.back);
    expect(facingStandee(AERIN, "east").assetId).toBe(AERIN.front);
    expect(facingStandee(AERIN, "south").assetId).toBe(AERIN.front);
  });

  it("mirrors the second of each pair and leaves the authored pose alone", () => {
    expect(facingStandee(AERIN, "north")).toEqual({ assetId: AERIN.back, flipX: false });
    expect(facingStandee(AERIN, "west")).toEqual({ assetId: AERIN.back, flipX: true });
    expect(facingStandee(AERIN, "east")).toEqual({ assetId: AERIN.front, flipX: false });
    expect(facingStandee(AERIN, "south")).toEqual({ assetId: AERIN.front, flipX: true });
  });
});
