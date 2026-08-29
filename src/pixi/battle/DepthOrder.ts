import type { GridPosition } from "../../game";

export interface DepthKey {
  readonly position: GridPosition;
  readonly layerPriority: number;
  readonly stableId: string;
}

export function compareDepth(left: DepthKey, right: DepthKey): number {
  return (
    left.position.x + left.position.y - (right.position.x + right.position.y) ||
    left.layerPriority - right.layerPriority ||
    left.stableId.localeCompare(right.stableId)
  );
}
