import { Point } from "pixi.js";
import { describe, expect, it } from "vitest";

import { BoardProjection } from "./BoardProjection";

const corners = [
  new Point(140, 90),
  new Point(860, 90),
  new Point(950, 720),
  new Point(50, 720),
] as const;

describe("BoardProjection", () => {
  it("round-trips a 10x8 square grid through one projective homography", () => {
    const projection = new BoardProjection();
    projection.update(10, 8, corners);
    for (const [col, row] of [[0, 0], [10, 8], [4.5, 3.25], [9.99, 7.99]] as const) {
      const screen = projection.gridToScreen(col, row);
      const grid = projection.screenToGrid(screen.x, screen.y);
      expect(grid.x).toBeCloseTo(col, 6);
      expect(grid.y).toBeCloseTo(row, 6);
    }
  });

  it("aligns first and last row corners exactly", () => {
    const projection = new BoardProjection();
    projection.update(10, 8, corners);
    expect(projection.gridToScreen(0, 0)).toEqual(corners[0]);
    expect(projection.gridToScreen(10, 0)).toEqual(corners[1]);
    expect(projection.gridToScreen(10, 8)).toEqual(corners[2]);
    expect(projection.gridToScreen(0, 8)).toEqual(corners[3]);
    expect(projection.getCellCorners(9, 7)[2]).toEqual(corners[2]);
  });

  it("uses subtle row depth scaling", () => {
    const projection = new BoardProjection();
    projection.update(10, 8, corners);
    expect(projection.getDepthScale(0)).toBeCloseTo(0.78);
    expect(projection.getDepthScale(8)).toBeCloseTo(1);
    expect(projection.getDepthScale(4)).toBeCloseTo(0.89);
    expect(projection.getProjectedCellWidth(8)).toBeGreaterThan(projection.getProjectedCellWidth(0));
  });

  it("rebuilds its inverse after resize or camera corner changes", () => {
    const projection = new BoardProjection();
    projection.update(10, 8, corners);
    const resized = corners.map((point) => new Point(point.x * 0.6 + 20, point.y * 0.75 + 12)) as [Point, Point, Point, Point];
    projection.update(10, 8, resized);
    const point = projection.gridToScreen(2.25, 6.5);
    const grid = projection.screenToGrid(point.x, point.y);
    expect(grid.x).toBeCloseTo(2.25, 6);
    expect(grid.y).toBeCloseTo(6.5, 6);
  });

  it.each([[3, 3], [9, 7], [5, 3]] as const)("keeps the active %ix%i scenario dimensions aligned", (columns, rows) => {
    const projection = new BoardProjection();
    projection.update(columns, rows, corners);
    const farCell = projection.getCellCorners(0, 0);
    const nearCell = projection.getCellCorners(columns - 1, rows - 1);
    expect(farCell[0]).toEqual(corners[0]);
    expect(nearCell[2]).toEqual(corners[2]);
    const center = projection.gridToScreen(columns / 2, rows / 2);
    const roundTrip = projection.screenToGrid(center.x, center.y);
    expect(roundTrip.x).toBeCloseTo(columns / 2, 6);
    expect(roundTrip.y).toBeCloseTo(rows / 2, 6);
  });
});
