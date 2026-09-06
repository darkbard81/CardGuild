import { describe, expect, it } from "vitest";

import { BoardProjection, type BoardPlacement } from "./BoardProjection";
import { DEFAULT_BOARD_VIEW_CONFIG } from "./BoardViewConfig";

const PLACEMENT: BoardPlacement = { originX: 640, originY: 400, scale: 0.75 };
const CELL = DEFAULT_BOARD_VIEW_CONFIG.boardTextureCellSize;

function projection(columns = 10, rows = 8, placement: BoardPlacement = PLACEMENT): BoardProjection {
  const board = new BoardProjection();
  board.update(columns, rows, placement);
  return board;
}

describe("BoardProjection", () => {
  it("round-trips fractional grid coordinates through the affine projection", () => {
    const board = projection();
    for (const [col, row] of [[0, 0], [10, 8], [4.5, 3.25], [9.99, 7.99], [-2, 11]] as const) {
      const screen = board.gridToScreen(col, row);
      const grid = board.screenToGrid(screen.x, screen.y);
      expect(grid.x).toBeCloseTo(col, 9);
      expect(grid.y).toBeCloseTo(row, 9);
    }
  });

  it("still round-trips after the camera has panned, zoomed and the canvas resized", () => {
    const board = projection();
    for (const placement of [
      { originX: 200, originY: 120, scale: 0.3 },
      { originX: 1440, originY: 900, scale: 2.4 },
      { originX: -80, originY: 640, scale: 1 },
    ]) {
      board.update(10, 8, placement);
      const screen = board.gridToScreen(2.25, 6.5);
      const grid = board.screenToGrid(screen.x, screen.y);
      expect(grid.x).toBeCloseTo(2.25, 9);
      expect(grid.y).toBeCloseTo(6.5, 9);
    }
  });

  it("puts one grid step on the diagonals: +X is (+u, +u/2) and +Y is (-u, +u/2)", () => {
    const board = projection();
    const unit = CELL * PLACEMENT.scale / Math.SQRT2;
    const origin = board.gridToScreen(3, 4);
    const alongX = board.gridToScreen(4, 4);
    const alongY = board.gridToScreen(3, 5);
    expect(alongX.x - origin.x).toBeCloseTo(unit, 9);
    expect(alongX.y - origin.y).toBeCloseTo(unit / 2, 9);
    expect(alongY.x - origin.x).toBeCloseTo(-unit, 9);
    expect(alongY.y - origin.y).toBeCloseTo(unit / 2, 9);
  });

  it("draws every cell as the same 2:1 diamond, near edge and far edge alike", () => {
    const board = projection();
    const size = (col: number, row: number): { width: number; height: number } => {
      const corners = board.getCellCorners(col, row);
      const xs = corners.map((corner) => corner.x);
      const ys = corners.map((corner) => corner.y);
      return { width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
    };
    const first = size(0, 0);
    expect(first.width).toBeCloseTo(board.getCellDiamondWidth(), 9);
    expect(first.width / first.height).toBeCloseTo(2, 9);
    // The corners, the middle and the opposite edge are all the same size: no convergence.
    for (const [col, row] of [[9, 0], [0, 7], [9, 7], [4, 3]] as const) {
      const other = size(col, row);
      expect(other.width).toBeCloseTo(first.width, 9);
      expect(other.height).toBeCloseTo(first.height, 9);
    }
  });

  it("keeps opposite board edges parallel", () => {
    const board = projection();
    const [top, right, bottom, left] = board.corners;
    const edge = (from: { x: number; y: number }, to: { x: number; y: number }): number =>
      Math.atan2(to.y - from.y, to.x - from.x);
    expect(edge(top, right)).toBeCloseTo(edge(left, bottom), 9);
    expect(edge(top, left)).toBeCloseTo(edge(right, bottom), 9);
  });

  it("scales content by the board's own scale, whatever row it stands on", () => {
    const board = projection();
    expect(board.getContentScale()).toBeCloseTo(PLACEMENT.scale, 9);
    // Halving the board halves the content scale rather than leaving sprites oversized.
    board.update(10, 8, { ...PLACEMENT, scale: PLACEMENT.scale / 2 });
    expect(board.getContentScale()).toBeCloseTo(PLACEMENT.scale / 2, 9);
    expect(board.getCellDiamondWidth()).toBeCloseTo(CELL * Math.SQRT2 * PLACEMENT.scale / 2, 9);
  });

  it("centres the board on the placement origin, whatever its shape", () => {
    for (const [columns, rows] of [[3, 3], [9, 7], [5, 3], [3, 9], [9, 3]] as const) {
      const board = projection(columns, rows);
      const corners = board.corners;
      const centerX = corners.reduce((total, corner) => total + corner.x, 0) / corners.length;
      const centerY = corners.reduce((total, corner) => total + corner.y, 0) / corners.length;
      expect(centerX).toBeCloseTo(PLACEMENT.originX, 9);
      expect(centerY).toBeCloseTo(PLACEMENT.originY, 9);
      const middle = board.screenToGrid(PLACEMENT.originX, PLACEMENT.originY);
      expect(middle.x).toBeCloseTo(columns / 2, 9);
      expect(middle.y).toBeCloseTo(rows / 2, 9);
    }
  });

  it("refuses a placement nothing can be drawn at", () => {
    const board = new BoardProjection();
    expect(() => board.update(0, 8, PLACEMENT)).toThrow(/dimensions must be positive/);
    expect(() => board.update(10, 8, { ...PLACEMENT, scale: 0 })).toThrow(/scale must be positive/);
  });
});
