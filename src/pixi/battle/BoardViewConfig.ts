export interface BoardViewConfig {
  readonly topYRatio: number;
  readonly bottomYRatio: number;
  readonly topWidthRatio: number;
  readonly bottomWidthRatio: number;
  readonly meshVerticesX: number;
  readonly meshVerticesY: number;
  readonly farDepthScale: number;
  readonly nearDepthScale: number;
  readonly actorFootRowOffset: number;
  readonly propFootRowOffset: number;
  readonly boardTextureCellSize: number;
}

export const DEFAULT_BOARD_VIEW_CONFIG: BoardViewConfig = Object.freeze({
  topYRatio: 0.15,
  bottomYRatio: 0.82,
  topWidthRatio: 0.72,
  bottomWidthRatio: 0.9,
  meshVerticesX: 20,
  meshVerticesY: 20,
  farDepthScale: 0.78,
  nearDepthScale: 1,
  actorFootRowOffset: 0.8,
  propFootRowOffset: 0.88,
  boardTextureCellSize: 128,
});

export function baseBoardCorners(
  viewportWidth: number,
  viewportHeight: number,
  config: BoardViewConfig = DEFAULT_BOARD_VIEW_CONFIG,
): readonly [
  { readonly x: number; readonly y: number },
  { readonly x: number; readonly y: number },
  { readonly x: number; readonly y: number },
  { readonly x: number; readonly y: number },
] {
  const centerX = viewportWidth / 2;
  const topHalf = viewportWidth * config.topWidthRatio / 2;
  const bottomHalf = viewportWidth * config.bottomWidthRatio / 2;
  const topY = viewportHeight * config.topYRatio;
  const bottomY = viewportHeight * config.bottomYRatio;
  return [
    { x: centerX - topHalf, y: topY },
    { x: centerX + topHalf, y: topY },
    { x: centerX + bottomHalf, y: bottomY },
    { x: centerX - bottomHalf, y: bottomY },
  ];
}
