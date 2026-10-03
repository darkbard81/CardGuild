import { Graphics, Point, Rectangle, Sprite, type Container } from "pixi.js";
import { foregroundStandeeRectangles, OCCLUDING_TERRAIN_ALPHA, unionRectangles, subtractRectangles, type DepthRectangle } from "./StandeeOcclusion";

function displayed(body: Container): boolean {
  for (let node: Container | null = body; node; node = node.parent) if (!node.visible || !node.renderable || node.alpha <= 0) return false;
  return true;
}
function terrainRectangle(surface: Sprite): Rectangle {
  const w = surface.texture.orig.width, h = surface.texture.orig.height;
  const corners = [[0, 0], [w, 0], [w, h], [0, h]].map(([x, y]) => surface.toGlobal(new Point(x! - surface.anchor.x * w, y! - surface.anchor.y * h)));
  const x = Math.min(...corners.map(point => point.x)), y = Math.min(...corners.map(point => point.y));
  return new Rectangle(x, y, Math.max(...corners.map(point => point.x)) - x, Math.max(...corners.map(point => point.y)) - y);
}
interface TerrainPasses { readonly normal: Sprite; readonly dim: Sprite; readonly outside: Graphics; readonly inside: Graphics; readonly bounds: Rectangle }
/** Rectangle clipping works in WebGL, WebGPU and Canvas fallback, with no character copy or silhouette extraction. */
export class TerrainOcclusion {
  private readonly passes = new Map<Container, TerrainPasses>();
  public update(terrain: readonly { display: Container; surface: Sprite }[], actors: readonly { display: Container; body: Sprite }[]): void {
    const rectangles: DepthRectangle[] = actors.filter(actor => displayed(actor.body)).map(actor => ({
      bounds: actor.body.getBounds().rectangle, depth: { zIndex: actor.display.zIndex, label: actor.display.label },
    }));
    for (const { display, surface } of terrain) {
      const regions = foregroundStandeeRectangles({ bounds: terrainRectangle(surface),
        depth: { zIndex: display.zIndex, label: display.label } }, rectangles);
      let passes = this.passes.get(display);
      if (!regions.length) {
        if (passes) { passes.normal.mask = null; passes.normal.visible = true; passes.outside.includeInBuild = false; passes.dim.visible = false; }
        continue;
      }
      if (!passes) {
        const dim = new Sprite({ texture: surface.texture, eventMode: "none", label: "translucent-terrain" });
        dim.position.copyFrom(surface.position); dim.anchor.copyFrom(surface.anchor); dim.scale.copyFrom(surface.scale);
        dim.alpha = OCCLUDING_TERRAIN_ALPHA;
        const outside = new Graphics({ label: "standee-rectangle-outside", eventMode: "none" });
        const inside = new Graphics({ label: "standee-rectangle-inside", eventMode: "none" });
        const bounds = terrainRectangle(surface);
        const a = display.toLocal(new Point(bounds.x, bounds.y)), b = display.toLocal(new Point(bounds.x + bounds.width, bounds.y + bounds.height));
        passes = { normal: surface, dim, outside, inside, bounds: new Rectangle(a.x, a.y, b.x - a.x, b.y - a.y) };
        display.addChild(dim, outside, inside); this.passes.set(display, passes);
      }
      const { bounds, normal, dim, outside, inside } = passes;
      const local = unionRectangles(regions).flatMap(rect => {
        const a = display.toLocal(new Point(rect.x, rect.y)), b = display.toLocal(new Point(rect.x + rect.width, rect.y + rect.height));
        const x = Math.max(bounds.x, a.x), y = Math.max(bounds.y, a.y);
        const right = Math.min(bounds.x + bounds.width, b.x), bottom = Math.min(bounds.y + bounds.height, b.y);
        return right > x && bottom > y ? [{ x, y, width: right - x, height: bottom - y }] : [];
      });
      outside.clear(); inside.clear();
      const opaque = subtractRectangles(bounds, local);
      for (const rect of opaque) outside.rect(rect.x, rect.y, rect.width, rect.height);
      if (opaque.length) outside.fill(0xffffff);
      for (const rect of local) inside.rect(rect.x, rect.y, rect.width, rect.height);
      if (local.length) inside.fill(0xffffff);
      normal.visible = opaque.length > 0;
      // Disjoint rectangle paths work without inverse/hole mask support.
      if (normal.mask !== outside) normal.mask = outside;
      if (dim.mask !== inside) dim.mask = inside;
      dim.visible = local.length > 0; outside.includeInBuild = false; inside.includeInBuild = false;
    }
  }
  public clear(): void {
    for (const { normal, dim, outside, inside } of this.passes.values()) {
      normal.mask = null; normal.visible = true; dim.mask = null;
      for (const child of [dim, outside, inside]) { child.removeFromParent(); child.destroy(); }
    }
    this.passes.clear();
  }
}
