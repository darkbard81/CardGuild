/** Full texture rectangle, including transparent padding; coordinates are screen pixels. */
export interface StandeeRectangle { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
export interface RenderDepth { readonly zIndex: number; readonly label: string }
export interface DepthRectangle { readonly bounds: StandeeRectangle; readonly depth: RenderDepth }
export const OCCLUDING_TERRAIN_ALPHA = 0.15;
export function overlaps(left: StandeeRectangle, right: StandeeRectangle): boolean {
  return left.x < right.x + right.width && left.x + left.width > right.x &&
    left.y < right.y + right.height && left.y + left.height > right.y;
}
/** Same ordering as RenderLayer, with no height/selection/silhouette analysis. */
export function foregroundStandeeRectangles(terrain: DepthRectangle, actors: readonly DepthRectangle[]): readonly StandeeRectangle[] {
  return actors.filter(actor => (terrain.depth.zIndex > actor.depth.zIndex ||
    (terrain.depth.zIndex === actor.depth.zIndex && terrain.depth.label.localeCompare(actor.depth.label) > 0)) &&
    actor.bounds.width > 0 && actor.bounds.height > 0 && overlaps(terrain.bounds, actor.bounds)).map(actor => actor.bounds);
}
/** Non-overlapping rectangles prevent Canvas even-odd holes from cancelling in shared actor areas. */
export function unionRectangles(rectangles: readonly StandeeRectangle[]): readonly StandeeRectangle[] {
  const edges = [...new Set(rectangles.flatMap(rect => [rect.y, rect.y + rect.height]))].sort((a, b) => a - b);
  const result: StandeeRectangle[] = [];
  for (let i = 1; i < edges.length; i++) {
    const y = edges[i - 1]!, endY = edges[i]!;
    const spans = rectangles.filter(rect => rect.y < endY && rect.y + rect.height > y)
      .map(rect => [rect.x, rect.x + rect.width] as const).sort((a, b) => a[0] - b[0]);
    let start: number | undefined, end = 0;
    for (const [x, endX] of spans) {
      if (start !== undefined && x > end) { result.push({ x: start, y, width: end - start, height: endY - y }); start = undefined; }
      if (start === undefined) { start = x; end = endX; } else end = Math.max(end, endX);
    }
    if (start !== undefined) result.push({ x: start, y, width: end - start, height: endY - y });
  }
  return result;
}

/** Rectangle complement avoids inverse/hole masks, so the same clipping works in Canvas fallback. */
export function subtractRectangles(base: StandeeRectangle, holes: readonly StandeeRectangle[]): readonly StandeeRectangle[] {
  const clipped = holes.flatMap(rect => {
    const x = Math.max(base.x, rect.x), y = Math.max(base.y, rect.y);
    const right = Math.min(base.x + base.width, rect.x + rect.width), bottom = Math.min(base.y + base.height, rect.y + rect.height);
    return right > x && bottom > y ? [{ x, y, width: right - x, height: bottom - y }] : [];
  });
  const edges = [...new Set([base.y, base.y + base.height, ...clipped.flatMap(rect => [rect.y, rect.y + rect.height])])].sort((a, b) => a - b);
  const result: StandeeRectangle[] = [];
  for (let i = 1; i < edges.length; i++) {
    const y = edges[i - 1]!, bottom = edges[i]!;
    const spans = clipped.filter(rect => rect.y < bottom && rect.y + rect.height > y).sort((a, b) => a.x - b.x);
    let x = base.x;
    for (const span of spans) {
      if (span.x > x) result.push({ x, y, width: span.x - x, height: bottom - y });
      x = Math.max(x, span.x + span.width);
    }
    if (x < base.x + base.width) result.push({ x, y, width: base.x + base.width - x, height: bottom - y });
  }
  return result;
}
