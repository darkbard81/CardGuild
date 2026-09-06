/**
 * Pixels reserved for the floating HUD on each edge of the canvas. The board is fitted
 * inside this rectangle so no square ever sits under an overlay panel. The values are
 * measured from the live HUD elements, never mirrored from style.css.
 */
export interface BoardSafeArea {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/**
 * How the outline around a solid region — walls and shut gates together — is stroked. It
 * lives here, with the rest of the board's presentation, because nothing about it is a
 * rule: the same wall blocks movement and sight whether the line is thick, thin or absent.
 */
export interface SolidBoundaryStyle {
  readonly color: number;
  readonly width: number;
  readonly alpha: number;
}

/**
 * The marker a standee stands on. It is drawn screen-aligned and squashed by the same
 * factor as the board, so it reads as lying flat on the plane while the body above it
 * stays upright. Authored against `referenceCellWidth`, like every other standee size.
 */
export interface StandeeBaseStyle {
  readonly radius: number;
  readonly fill: number;
  readonly fillAlpha: number;
  readonly stroke: number;
  readonly strokeAlpha: number;
  readonly strokeWidth: number;
}

export interface BoardViewConfig {
  /**
   * The board plane's fixed turn, applied before the squash. A quarter turn puts the
   * grid's two axes on the screen diagonals; nothing about the camera changes it at
   * runtime, and nothing in the rules can see it.
   */
  readonly boardRotationRadians: number;
  /** Screen-space vertical squash applied after the turn, which is what makes a cell a 2:1 diamond. */
  readonly boardSquashY: number;
  /**
   * Cell width the art is authored against. Board content is scaled by the board's own
   * uniform scale over this value, so a standee keeps the same share of its square at
   * every window size and only the camera zoom changes it.
   */
  readonly referenceCellWidth: number;
  /**
   * How many squares across the board fills the frame at full zoom. Expressed in squares
   * rather than pixels so "fully zoomed" means the same thing on every map *and* on every
   * monitor: a pixel target is a different number of squares on a laptop than on a large
   * display, and stops binding at all once the window is big enough.
   */
  readonly closeUpCells: number;
  /** Zoom-in always available, even on a map whose fitted squares are already large. */
  readonly minZoomHeadroom: number;
  readonly boardTextureCellSize: number;
  /** Share of the safe area a fitted board fills, so it never sits flush against the HUD. */
  readonly boardFitMargin: number;
  /** Drawn over the square grid, so a barrier reads ahead of the ordinary cell lines. */
  readonly solidBoundary: SolidBoundaryStyle;
  readonly standeeBase: StandeeBaseStyle;
}

/** Used until the HUD has been laid out and measured. */
export const ZERO_BOARD_SAFE_AREA: BoardSafeArea = Object.freeze({
  left: 0,
  top: 0,
  right: 0,
  bottom: 0,
});

const MIN_BOARD_EXTENT = 240;

export const DEFAULT_BOARD_VIEW_CONFIG: BoardViewConfig = Object.freeze({
  boardRotationRadians: Math.PI / 4,
  boardSquashY: 0.5,
  referenceCellWidth: 128,
  closeUpCells: 3,
  minZoomHeadroom: 1.5,
  boardFitMargin: 0.94,
  boardTextureCellSize: 128,
  solidBoundary: { color: 0xaaa38f, width: 7, alpha: 0.9 },
  standeeBase: {
    radius: 42,
    fill: 0x120f0c,
    fillAlpha: 0.38,
    stroke: 0xd8c79f,
    strokeAlpha: 0.42,
    strokeWidth: 2,
  },
});

/** Everything the camera needs to frame one board inside the current canvas. */
export interface BoardFrame {
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly columns: number;
  readonly rows: number;
  readonly safeArea: BoardSafeArea;
}

export interface BoardArea {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly centerX: number;
  readonly centerY: number;
}

/** The rectangle left over once the HUD has taken its gutters. */
export function boardSafeBox(frame: BoardFrame): BoardArea {
  const { left, top, right, bottom } = frame.safeArea;
  const width = Math.max(MIN_BOARD_EXTENT, frame.viewportWidth - left - right);
  const height = Math.max(MIN_BOARD_EXTENT, frame.viewportHeight - top - bottom);
  return { left, top, width, height, centerX: left + width / 2, centerY: top + height / 2 };
}

/**
 * Screen size of the whole board at scale 1. The turn spreads a `columns x rows`
 * rectangle across both screen axes — which is why the fit has to know the rows and not
 * only the columns — and the squash then halves the height.
 */
export function boardPlaneExtent(
  frame: BoardFrame,
  config: BoardViewConfig,
): { readonly width: number; readonly height: number } {
  const cosine = Math.abs(Math.cos(config.boardRotationRadians));
  const sine = Math.abs(Math.sin(config.boardRotationRadians));
  const boardWidth = Math.max(1, frame.columns) * config.boardTextureCellSize;
  const boardHeight = Math.max(1, frame.rows) * config.boardTextureCellSize;
  return {
    width: boardWidth * cosine + boardHeight * sine,
    height: (boardWidth * sine + boardHeight * cosine) * config.boardSquashY,
  };
}

/** Screen width of one cell's left-to-right diagonal at scale 1. */
export function cellDiamondWidth(config: BoardViewConfig): number {
  const cosine = Math.abs(Math.cos(config.boardRotationRadians));
  const sine = Math.abs(Math.sin(config.boardRotationRadians));
  return config.boardTextureCellSize * (cosine + sine);
}

/**
 * The frame a fully zoomed-in camera fills: the middle `closeUpCells` squares of the
 * board, or the whole board when it is smaller than that. Clamping matters — a map
 * already smaller than the close-up would otherwise ask to be zoomed *out*.
 */
export function closeUpFrame(frame: BoardFrame, config: BoardViewConfig): BoardFrame {
  return {
    ...frame,
    columns: Math.min(frame.columns, config.closeUpCells),
    rows: Math.min(frame.rows, config.closeUpCells),
  };
}

/** Uniform scale at which the whole board just fits inside the safe area. */
export function boardFitScale(frame: BoardFrame, config: BoardViewConfig): number {
  const area = boardSafeBox(frame);
  const extent = boardPlaneExtent(frame, config);
  return Math.min(
    (area.width * config.boardFitMargin) / extent.width,
    (area.height * config.boardFitMargin) / extent.height,
  );
}
