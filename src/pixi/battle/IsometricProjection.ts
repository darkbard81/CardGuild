import type { GridPosition } from "../../game";

export interface IsometricMetrics {
  readonly tileWidth: number;
  readonly tileHeight: number;
}

export interface IsoPoint {
  readonly x: number;
  readonly y: number;
}

// gridToIso returns the center of the tile's top diamond. Terrain, overlays,
// grounded objects, actor feet, and pointer inversion all use this one origin.
export const M2_ISOMETRIC_METRICS: IsometricMetrics = { tileWidth: 64, tileHeight: 32 };

export function gridToIso(position: GridPosition, metrics: IsometricMetrics = M2_ISOMETRIC_METRICS): IsoPoint {
  return {
    x: (position.x - position.y) * metrics.tileWidth / 2,
    y: (position.x + position.y) * metrics.tileHeight / 2,
  };
}

export function isoToGrid(point: IsoPoint, metrics: IsometricMetrics = M2_ISOMETRIC_METRICS): GridPosition | null {
  const approximateX = point.y / metrics.tileHeight + point.x / metrics.tileWidth;
  const approximateY = point.y / metrics.tileHeight - point.x / metrics.tileWidth;
  const candidates: GridPosition[] = [];
  const baseX = Math.floor(approximateX);
  const baseY = Math.floor(approximateY);
  for (let y = baseY - 1; y <= baseY + 2; y += 1) {
    for (let x = baseX - 1; x <= baseX + 2; x += 1) {
      const center = gridToIso({ x, y }, metrics);
      const diamondDistance =
        Math.abs(point.x - center.x) / (metrics.tileWidth / 2) +
        Math.abs(point.y - center.y) / (metrics.tileHeight / 2);
      if (diamondDistance <= 1 + 1e-9) candidates.push({ x, y });
    }
  }
  candidates.sort((left, right) =>
    left.x + left.y - (right.x + right.y) || left.y - right.y || left.x - right.x,
  );
  return candidates[0] ?? null;
}

export function diamondPoints(
  center: IsoPoint,
  metrics: IsometricMetrics = M2_ISOMETRIC_METRICS,
  inset = 0,
): number[] {
  const halfWidth = metrics.tileWidth / 2 - inset;
  const halfHeight = metrics.tileHeight / 2 - inset / 2;
  return [
    center.x, center.y - halfHeight,
    center.x + halfWidth, center.y,
    center.x, center.y + halfHeight,
    center.x - halfWidth, center.y,
  ];
}
