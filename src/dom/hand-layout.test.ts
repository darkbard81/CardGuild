import { describe, expect, it } from "vitest";
import { handLayout } from "./hand-layout";

describe("hand fan", () => {
  it("centres one card and handles an empty hand", () => {
    expect(handLayout(0, 640).cards).toEqual([]);
    expect(handLayout(1, 640).cards).toEqual([{ x: 0, y: 0, angle: 0 }]);
  });
  it.each([7, 8, 9, 30])("bounds %i cards to eight and symmetric ten-degree edges", count => {
    const { cards, capacity } = handLayout(count, 640);
    expect(capacity).toBe(8); expect(cards).toHaveLength(Math.min(8, count));
    expect(cards[0]!.angle).toBe(-10); expect(cards.at(-1)!.angle).toBe(10);
    expect(cards[0]!.x).toBe(-cards.at(-1)!.x);
    for (let index = 1; index < cards.length; index++) expect(cards[index]!.x - cards[index - 1]!.x).toBeGreaterThanOrEqual(44);
  });
  it("reduces page capacity before overlap makes touch strips too narrow", () => {
    expect(handLayout(9, 320).capacity).toBe(5);
    expect(handLayout(9, 140).capacity).toBe(1);
  });
});
