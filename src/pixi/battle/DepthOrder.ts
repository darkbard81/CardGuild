export interface DepthKey {
  readonly screenY: number;
  readonly layerPriority: number;
  readonly stableId: string;
}

export function compareDepth(left: DepthKey, right: DepthKey): number {
  return (
    left.screenY - right.screenY ||
    left.layerPriority - right.layerPriority ||
    left.stableId.localeCompare(right.stableId)
  );
}
