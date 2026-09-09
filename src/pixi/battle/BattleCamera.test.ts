import { describe, expect, it } from "vitest";

import { BattleCamera } from "./BattleCamera";
import { BoardProjection } from "./BoardProjection";
import type { BoardFrame } from "./BoardViewConfig";
import { boardSafeBox, cellDiamondWidth, DEFAULT_BOARD_VIEW_CONFIG } from "./BoardViewConfig";

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

/** One of the board's four grid corners, in screen space. */
function corner(camera: BattleCamera, board: BoardFrame, index: number): { x: number; y: number } {
  const point = project(camera, board).corners[index];
  if (!point) throw new Error(`Board has no corner ${index}.`);
  return { x: point.x, y: point.y };
}

function zoomedIn(board: BoardFrame): BattleCamera {
  const camera = new BattleCamera();
  camera.zoomBy(1000, board.viewportWidth / 2, board.viewportHeight / 2, board);
  return camera;
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

  it("lets a small map reach the close-up instead of leaving it on the headroom floor", () => {
    const camera = new BattleCamera();
    // The close-up is one square, so even a 3x3 map is a long way from it and reaches a
    // real close-up rather than the bare 1.5x floor it used to be stuck on.
    expect(camera.maxZoom(frame(3, 3))).toBeCloseTo(3, 6);
    expect(camera.maxZoom(frame(3, 3))).toBeGreaterThan(DEFAULT_BOARD_VIEW_CONFIG.minZoomHeadroom);
    // A 9x7 map starts further out, so it still has further to travel.
    expect(camera.maxZoom(frame(9, 7))).toBeGreaterThan(camera.maxZoom(frame(3, 3)));
  });

  it("zooms in until the close-up's squares fill the frame, on any map", () => {
    const cells = DEFAULT_BOARD_VIEW_CONFIG.closeUpCells;
    for (const [columns, rows] of [[9, 7], [3, 9], [9, 3]] as const) {
      const camera = new BattleCamera();
      const board = frame(columns, rows);
      camera.zoomBy(1000, board.viewportWidth / 2, board.viewportHeight / 2, board);
      // Fully zoomed in, one cell is as wide as the fitted cell of a board that is
      // nothing but the close-up: three squares fill the frame, whatever the map.
      const closeUp = new BattleCamera();
      const closeUpBoard = frame(cells, cells);
      expect(project(camera, board).getCellDiamondWidth())
        .toBeCloseTo(project(closeUp, closeUpBoard).getCellDiamondWidth(), 6);
    }
  });

  it("means the same close-up on a small window and a large one", () => {
    // A pixel target stops binding once the window is big enough and pins a different
    // number of squares on every monitor. A framing does not.
    const zoomed = (viewportWidth: number, viewportHeight: number): number => {
      const camera = new BattleCamera();
      const board: BoardFrame = { ...frame(9, 7), viewportWidth, viewportHeight };
      camera.zoomBy(1000, viewportWidth / 2, viewportHeight / 2, board);
      const cells = DEFAULT_BOARD_VIEW_CONFIG.closeUpCells;
      const closeUp: BoardFrame = { ...frame(cells, cells), viewportWidth, viewportHeight };
      return project(camera, board).getCellDiamondWidth()
        / project(new BattleCamera(), closeUp).getCellDiamondWidth();
    };
    expect(zoomed(1024, 768)).toBeCloseTo(1, 6);
    expect(zoomed(1280, 800)).toBeCloseTo(1, 6);
    expect(zoomed(1920, 1080)).toBeCloseTo(1, 6);
  });

  it("keeps the wheel alive on the one board that is already its own close-up", () => {
    // At one close-up square only a 1x1 board frames itself, and framing it again is zoom
    // 1 — which would leave nothing to zoom. Everything larger earns real range.
    expect(new BattleCamera().maxZoom(frame(1, 1)))
      .toBeCloseTo(DEFAULT_BOARD_VIEW_CONFIG.minZoomHeadroom, 6);
    for (const [columns, rows] of [[1, 1], [2, 2], [3, 3], [5, 3]] as const) {
      const board = frame(columns, rows);
      expect(zoomedIn(board).scale).toBeGreaterThanOrEqual(DEFAULT_BOARD_VIEW_CONFIG.minZoomHeadroom);
    }
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

  it("keeps a fitted board's centre inside the safe area however far it is dragged", () => {
    // A board that fits needs no more reach than the safe area, so the clamp is exactly
    // what it always was: drag as hard as you like and the centre stops at the corner.
    const camera = new BattleCamera();
    const board = frame(9);

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

  it("lets a zoomed-in board travel far enough to look at any square", () => {
    // Pinning the centre to the safe area is the right rule for a board that fits and the
    // wrong one for a board several screens wide: at the ceiling it would leave about a
    // quarter of a 9x7 map unreachable. Every corner has to be able to come to the middle.
    for (const [columns, rows] of [[3, 3], [9, 7], [3, 9], [12, 12]] as const) {
      const board = frame(columns, rows);
      const area = boardSafeBox(board);
      for (const index of [0, 1, 2, 3]) {
        const camera = zoomedIn(board);
        const at = corner(camera, board, index);
        camera.panBy(area.centerX - at.x, area.centerY - at.y, board);
        const moved = corner(camera, board, index);
        expect(moved.x, `${columns}x${rows} corner ${index}`).toBeCloseTo(area.centerX, 6);
        expect(moved.y, `${columns}x${rows} corner ${index}`).toBeCloseTo(area.centerY, 6);
      }
    }
  });

  it("still keeps board under the middle of the screen at the end of any drag", () => {
    // The reach is widened, not removed: the board may be dragged until an edge reaches
    // the centre of the safe area, and no further, so there is always something to drag
    // back from.
    const board = frame(9, 7);
    const area = boardSafeBox(board);
    for (const [dx, dy] of [[9000, 0], [-9000, 0], [0, 9000], [0, -9000], [9000, 9000]] as const) {
      const camera = zoomedIn(board);
      camera.panBy(dx, dy, board);
      const box = boardBox(camera, board);
      expect(area.centerX).toBeGreaterThanOrEqual(box.left - 0.001);
      expect(area.centerX).toBeLessThanOrEqual(box.right + 0.001);
      expect(area.centerY).toBeGreaterThanOrEqual(box.top - 0.001);
      expect(area.centerY).toBeLessThanOrEqual(box.bottom + 0.001);
    }
  });

  it("keeps the zoom range when the canvas resizes, and re-clamps the pan", () => {
    const camera = new BattleCamera();
    const small = frame(9);
    camera.zoomBy(1000, small.viewportWidth / 2, small.viewportHeight / 2, small);
    const zoomed = camera.scale;
    // Both ends of the range are framings of the same board, so resizing changes how many
    // pixels a square gets but not how far the player may zoom. A resize used to move the
    // ceiling under the live zoom; now there is nothing for it to move.
    const wide: BoardFrame = { ...small, viewportWidth: 2400 };
    expect(camera.maxZoom(wide)).toBeCloseTo(camera.maxZoom(small), 9);
    camera.clamp(wide);
    expect(camera.scale).toBeCloseTo(zoomed, 9);
    // The pan is still clamped against the new canvas, which is what resize is for. At
    // the ceiling the board is far wider than the canvas, so the stop is the reach that
    // brings its edge to the middle rather than the safe area's own corner.
    camera.panBy(9000, 0, wide);
    const stopped = center(camera, wide).x;
    expect(Number.isFinite(stopped)).toBe(true);
    const box = boardBox(camera, wide);
    expect(boardSafeBox(wide).centerX).toBeCloseTo(box.left, 6);
    camera.panBy(9000, 0, wide);
    expect(center(camera, wide).x).toBeCloseTo(stopped, 6);
  });

  it("comes back to the same framing when a pinch is undone against the ceiling", () => {
    // A pinch is a ratio against where the fingers started, so the camera takes absolute
    // framings. If it multiplied the live zoom instead, the clamp would eat the overshoot:
    // spreading past the ceiling and pinching the same amount back would end zoomed *out*,
    // which is what a two-finger drag at full zoom used to do to itself.
    const board = frame(9);
    const area = boardSafeBox(board);
    const camera = new BattleCamera();
    camera.zoomTo(camera.maxZoom(board), area.centerX, area.centerY, board);
    const ceiling = camera.scale;
    expect(ceiling).toBe(camera.maxZoom(board));

    for (const overshoot of [1.05, 1.5, 4]) {
      camera.zoomTo(ceiling * overshoot, area.centerX, area.centerY, board);
      expect(camera.scale).toBe(ceiling);
      camera.zoomTo(ceiling, area.centerX, area.centerY, board);
      expect(camera.scale).toBe(ceiling);
    }
    // The same at the floor, which a pinch reaches by closing the fingers.
    camera.zoomTo(0.1, area.centerX, area.centerY, board);
    expect(camera.scale).toBe(camera.defaultZoom);
    camera.zoomTo(camera.defaultZoom, area.centerX, area.centerY, board);
    expect(camera.scale).toBe(camera.defaultZoom);
  });

  it("never changes the zoom while panning", () => {
    const board = frame(9);
    const camera = zoomedIn(board);
    const zoomed = camera.scale;

    for (const [dx, dy] of [[-14, 0], [-120, -80], [900, 600], [-9000, 0], [0, 9000]] as const) {
      camera.panBy(dx, dy, board);
      expect(camera.scale).toBe(zoomed);
    }
  });

  it("ends on a close-up of a character: one square, and a standee about that tall", () => {
    // Why the close-up is one square. A standee is authored a little under a cell diamond
    // wide, so once a single diamond fills the frame the body spans about the whole of it
    // — which is the framing "zoom in on this character" actually means. The ratio below
    // is the part that is fixed; how much of the *screen height* that comes to depends on
    // the window's shape, not on its size and not on the map.
    const config = DEFAULT_BOARD_VIEW_CONFIG;
    const standeeHeight = 152; // the shipped actors run 132..164 against a 128px cell
    for (const [columns, rows] of [[3, 3], [9, 7], [12, 12]] as const) {
      const board = frame(columns, rows);
      const diamond = project(zoomedIn(board), board).getCellDiamondWidth();
      // One square fills the safe area's binding axis, whatever the map.
      expect(diamond).toBeCloseTo(boardSafeBox(board).width * config.boardFitMargin, 6);
      const scale = diamond / cellDiamondWidth(config);
      const onScreen = standeeHeight * scale * config.boardTextureCellSize / config.referenceCellWidth;
      expect(onScreen / diamond).toBeCloseTo(standeeHeight / cellDiamondWidth(config), 6);
      expect(onScreen).toBeGreaterThan(boardSafeBox(board).height * 0.8);
    }
  });

  it("counts the zoom range in squares, not pixels", () => {
    // Every board is the same 2:1 shape once turned and squashed, so the whole map and
    // the close-up always fit on the same axis and the ratio between them is exactly the
    // ratio of their sizes in squares. That is why the range does not move with the window.
    const cells = DEFAULT_BOARD_VIEW_CONFIG.closeUpCells;
    for (const [columns, rows] of [[9, 7], [7, 4], [3, 9], [12, 12], [3, 3]] as const) {
      // One close-up square makes this exactly (columns + rows) / 2.
      const expected = (columns + rows) / (Math.min(columns, cells) + Math.min(rows, cells));
      const zoom = Math.max(expected, DEFAULT_BOARD_VIEW_CONFIG.minZoomHeadroom);
      for (const [viewportWidth, viewportHeight] of [[1024, 768], [1280, 800], [1920, 1080]] as const) {
        const board: BoardFrame = { ...frame(columns, rows), viewportWidth, viewportHeight };
        expect(new BattleCamera().maxZoom(board)).toBeCloseTo(zoom, 9);
      }
    }
  });
});
