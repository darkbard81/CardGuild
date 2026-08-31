/**
 * Pixels reserved for the floating HUD on each edge of the canvas. The board quad is
 * projected inside this rectangle so no square ever sits under an overlay panel. The
 * values are measured from the live HUD elements, never mirrored from style.css.
 */
export interface BoardSafeArea {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export interface BoardViewConfig {
  readonly topYRatio: number;
  readonly bottomYRatio: number;
  readonly topWidthRatio: number;
  readonly bottomWidthRatio: number;
  readonly meshVerticesX: number;
  readonly meshVerticesY: number;
  /**
   * Cell width the art is authored against. Board content is scaled by the projected
   * cell width over this value, so a standee keeps the same share of its square at
   * every window size and only the camera zoom changes it.
   */
  readonly referenceCellWidth: number;
  readonly actorFootRowOffset: number;
  readonly propFootRowOffset: number;
  readonly boardTextureCellSize: number;
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
  topYRatio: 0.06,
  bottomYRatio: 0.97,
  topWidthRatio: 0.76,
  bottomWidthRatio: 0.96,
  meshVerticesX: 20,
  meshVerticesY: 20,
  referenceCellWidth: 128,
  actorFootRowOffset: 0.8,
  propFootRowOffset: 0.88,
  boardTextureCellSize: 128,
});

export function baseBoardCorners(
  viewportWidth: number,
  viewportHeight: number,
  config: BoardViewConfig = DEFAULT_BOARD_VIEW_CONFIG,
  safeArea: BoardSafeArea = ZERO_BOARD_SAFE_AREA,
): readonly [
  { readonly x: number; readonly y: number },
  { readonly x: number; readonly y: number },
  { readonly x: number; readonly y: number },
  { readonly x: number; readonly y: number },
] {
  const { left, top, right, bottom } = safeArea;
  const areaWidth = Math.max(MIN_BOARD_EXTENT, viewportWidth - left - right);
  const areaHeight = Math.max(MIN_BOARD_EXTENT, viewportHeight - top - bottom);
  const centerX = left + areaWidth / 2;
  const topHalf = areaWidth * config.topWidthRatio / 2;
  const bottomHalf = areaWidth * config.bottomWidthRatio / 2;
  const topY = top + areaHeight * config.topYRatio;
  const bottomY = top + areaHeight * config.bottomYRatio;
  return [
    { x: centerX - topHalf, y: topY },
    { x: centerX + topHalf, y: topY },
    { x: centerX + bottomHalf, y: bottomY },
    { x: centerX - bottomHalf, y: bottomY },
  ];
}
