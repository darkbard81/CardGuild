import { describe, expect, it } from "vitest";

import { BattleCamera } from "./BattleCamera";
import { BoardProjection } from "./BoardProjection";
import type { BoardFrame } from "./BoardViewConfig";
import { boardSafeBox, DEFAULT_BOARD_VIEW_CONFIG } from "./BoardViewConfig";

const SAFE_AREA = { left: 250, top: 96, right: 268, bottom: 178 };

function frame(columns: number, rows = 7): BoardFrame {
  return { viewportWidth: 1280, viewportHeight: 800, columns, rows, safeArea: SAFE_AREA };
}

function project(camera: BattleCamera, board: BoardFrame): BoardProjection {
  const projection = new BoardProjection();
  projection.update(board.columns, board.rows, camera.placement(board));
  return projection;
}

function boardBox(camera: BattleCamera, board: BoardFrame): { left: number; right: number; top: number; bottom: number } {
  const corners = project(camera, board).corners;
  return {
    left: Math.min(...corners.map((corner) => corner.x)),
    right: Math.max(...corners.map((corner) => corner.x)),
    top: Math.min(...corners.map((corner) => corner.y)),
    bottom: Math.max(...corners.map((corner) => corner.y)),
  };
}

function center(camera: BattleCamera, board: BoardFrame): { x: number; y: number } {
  const placement = camera.placement(board);
  return { x: placement.originX, y: placement.originY };
}

describe("BattleCamera", () => {
  it.each([[3, 3], [5, 3], [9, 7], [3, 9], [9, 3]] as const)(
    "fits a %ix%i board inside the safe area at rest",
    (columns, rows) => {
      const camera = new BattleCamera();
      const board = frame(columns, rows);
      const area = boardSafeBox(board);
      const box = boardBox(camera, board);
      expect(box.left).toBeGreaterThanOrEqual(area.left - 0.001);
      expect(box.right).toBeLessThanOrEqual(area.left + area.width + 0.001);
      expect(box.top).toBeGreaterThanOrEqual(area.top - 0.001);
      expect(box.bottom).toBeLessThanOrEqual(area.top + area.height + 0.001);
      // The fit is tight on one axis: a board that fitted with room to spare on both
      // would just be drawn smaller than it needs to be.
      const widthFill = (box.right - box.left) / (area.width * DEFAULT_BOARD_VIEW_CONFIG.boardFitMargin);
      const heightFill = (box.bottom - box.top) / (area.height * DEFAULT_BOARD_VIEW_CONFIG.boardFitMargin);
      expect(Math.max(widthFill, heightFill)).toBeCloseTo(1, 6);
    },
  );

  it("gives a dense map the zoom range a sparse one already has by default", () => {
    const camera = new BattleCamera();
    // A 3x3 map fits with diamonds wider than the target, so only the headroom floor applies.
    expect(project(camera, frame(3, 3)).getCellDiamondWidth()).toBeGreaterThan(DEFAULT_BOARD_VIEW_CONFIG.maxCellWidth);
    expect(camera.maxZoom(frame(3, 3))).toBeCloseTo(DEFAULT_BOARD_VIEW_CONFIG.minZoomHeadroom, 6);
    // A 9x7 map fits with small diamonds, so it may zoom much further in.
    expect(camera.maxZoom(frame(9, 7))).toBeGreaterThan(camera.maxZoom(frame(3, 3)));
  });

  it("zooms in until a cell diamond reaches the target width, on any map", () => {
    for (const [columns, rows] of [[9, 7], [3, 9], [9, 3]] as const) {
      const camera = new BattleCamera();
      const board = frame(columns, rows);
      camera.zoomBy(1000, board.viewportWidth / 2, board.viewportHeight / 2, board);
      expect(project(camera, board).getCellDiamondWidth()).toBeCloseTo(DEFAULT_BOARD_VIEW_CONFIG.maxCellWidth, 6);
    }
    // A map whose fitted diamonds are already close to the target still keeps the
    // headroom floor, so it overshoots rather than losing its zoom.
    const camera = new BattleCamera();
    const board = frame(5, 3);
    camera.zoomBy(1000, board.viewportWidth / 2, board.viewportHeight / 2, board);
    expect(camera.scale).toBeCloseTo(DEFAULT_BOARD_VIEW_CONFIG.minZoomHeadroom, 6);
    expect(project(camera, board).getCellDiamondWidth()).toBeGreaterThan(DEFAULT_BOARD_VIEW_CONFIG.maxCellWidth);
  });

  it("never zooms out past the fitted board", () => {
    const camera = new BattleCamera();
    const board = frame(9);
    const fitted = project(camera, board).getCellDiamondWidth();
    camera.zoomBy(0.1, board.viewportWidth / 2, board.viewportHeight / 2, board);
    expect(camera.scale).toBe(camera.defaultZoom);
    expect(project(camera, board).getCellDiamondWidth()).toBeCloseTo(fitted, 6);
  });

  it("holds the square under the pointer still while zooming towards it", () => {
    const camera = new BattleCamera();
    const board = frame(9);
    const pointer = { x: 700, y: 300 };
    const before = project(camera, board).screenToGrid(pointer.x, pointer.y);
    camera.zoomBy(1.8, pointer.x, pointer.y, board);
    const after = project(camera, board).screenToGrid(pointer.x, pointer.y);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
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
    // Widening the canvas fits wider diamonds, so the ceiling drops under the live zoom.
    const wide: BoardFrame = { ...small, viewportWidth: 2400 };
    expect(camera.maxZoom(wide)).toBeLessThan(zoomed);
    camera.clamp(wide);
    expect(camera.scale).toBeCloseTo(camera.maxZoom(wide), 6);
  });
});
