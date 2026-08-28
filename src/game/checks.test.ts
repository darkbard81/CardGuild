import { describe, expect, it } from "vitest";

import { resolveDegree } from "./checks";
import { createRng, nextInt, shuffle } from "./rng";

describe("deterministic checks and RNG", () => {
  it("applies natural 20 and natural 1 as one-degree adjustments", () => {
    expect(resolveDegree(20, -15, 20)).toEqual({
      total: 5,
      baseDegree: "critical-failure",
      degree: "failure",
    });
    expect(resolveDegree(1, 30, 20)).toEqual({
      total: 31,
      baseDegree: "critical-success",
      degree: "success",
    });
  });

  it("repeats integer and shuffle sequences for the same seed", () => {
    const first = nextInt(createRng(1234), 1, 20);
    const second = nextInt(createRng(1234), 1, 20);
    expect(first).toEqual(second);

    const left = shuffle([1, 2, 3, 4, 5, 6], createRng(99));
    const right = shuffle([1, 2, 3, 4, 5, 6], createRng(99));
    expect(left).toEqual(right);
  });
});
