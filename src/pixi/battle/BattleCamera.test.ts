import { describe, expect, it } from "vitest";

import { BattleCamera } from "./BattleCamera";
import type { BoardFrame } from "./BoardViewConfig";
import { DEFAULT_BOARD_VIEW_CONFIG } from "./BoardViewConfig";

const SAFE_AREA = { left: 250, top: 96, right: 268, bottom: 178 };

function frame(columns: number): BoardFrame {
  return { viewportWidth: 1280, viewportHeight: 800, columns, safeArea: SAFE_AREA };
}

function cellWidth(camera: BattleCamera, board: BoardFrame): number {
  const corners = camera.corners(board);
  return (corners[2].x - corners[3].x) / board.columns;
}

function center(camera: BattleCamera, board: BoardFrame): { x: number; y: number } {
  const corners = camera.corners(board);
  return {
    x: corners.reduce((total, corner) => total + corner.x, 0) / corners.length,
    y: corners.reduce((total, corner) => total + corner.y, 0) / corners.length,
  };
}

describe("BattleCamera", () => {
  it("gives a dense map the zoom range a sparse one already has by default", () => {
    const camera = new BattleCamera();
    // A 3x3 map fits with squares wider than the target, so only the headroom floor applies.
    expect(cellWidth(camera, frame(3))).toBeGreaterThan(DEFAULT_BOARD_VIEW_CONFIG.maxCellWidth);
    expect(camera.maxZoom(frame(3))).toBeCloseTo(DEFAULT_BOARD_VIEW_CONFIG.minZoomHeadroom, 6);
    // A 9x7 map fits with small squares, so it may zoom much further in.
    expect(camera.maxZoom(frame(9))).toBeGreaterThan(camera.maxZoom(frame(3)));
  });

  it("zooms in until a square reaches the target width, on any map", () => {
    for (const columns of [5, 9]) {
      const camera = new BattleCamera();
      const board = frame(columns);
      camera.zoomBy(1000, board.viewportWidth / 2, board.viewportHeight / 2, board);
      expect(cellWidth(camera, board)).toBeCloseTo(DEFAULT_BOARD_VIEW_CONFIG.maxCellWidth, 6);
    }
  });

  it("never zooms out past the fitted board", () => {
    const camera = new BattleCamera();
    const board = frame(9);
    const fitted = cellWidth(camera, board);
    camera.zoomBy(0.1, board.viewportWidth / 2, board.viewportHeight / 2, board);
    expect(camera.scale).toBe(camera.defaultZoom);
    expect(cellWidth(camera, board)).toBeCloseTo(fitted, 6);
  });

  it("keeps the board centre inside the safe area however far it is dragged", () => {
    const camera = new BattleCamera();
    const board = frame(9);
    camera.zoomBy(4, board.viewportWidth / 2, board.viewportHeight / 2, board);

    const nudged = { ...center(camera, board) };
    camera.panBy(40, 25, board);
    expect(center(camera, board).x).toBeCloseTo(nudged.x + 40, 6);
    expect(center(camera, board).y).toBeCloseTo(nudged.y + 25, 6);

    camera.panBy(9000, 9000, board);
    const far = center(camera, board);
    expect(far.x).toBeCloseTo(board.viewportWidth - SAFE_AREA.right, 6);
    expect(far.y).toBeCloseTo(board.viewportHeight - SAFE_AREA.bottom, 6);

    camera.panBy(-9000, -9000, board);
    const near = center(camera, board);
    expect(near.x).toBeCloseTo(SAFE_AREA.left, 6);
    expect(near.y).toBeCloseTo(SAFE_AREA.top, 6);
  });

  it("re-clamps a zoom the canvas has outgrown", () => {
    const camera = new BattleCamera();
    const small = frame(9);
    camera.zoomBy(1000, small.viewportWidth / 2, small.viewportHeight / 2, small);
    const zoomed = camera.scale;
    // Widening the canvas fits wider squares, so the ceiling drops under the live zoom.
    const wide: BoardFrame = { ...small, viewportWidth: 2400 };
    expect(camera.maxZoom(wide)).toBeLessThan(zoomed);
    camera.clamp(wide);
    expect(camera.scale).toBeCloseTo(camera.maxZoom(wide), 6);
  });
});
