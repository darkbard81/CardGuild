import { type Application, Container, Rectangle, RenderTexture, Sprite } from "pixi.js";

/** Static columns are composited once and shared by the normal and translucent terrain passes. */
export class TerrainColumnTextures {
  private readonly cache = new Map<string, { texture: RenderTexture; bounds: Rectangle }>();
  private readonly used = new Set<string>();
  public constructor(private readonly app: Application) {}
  public begin(): void { this.used.clear(); }
  public sprite(key: string, content: Container): Sprite {
    this.used.add(key);
    let item = this.cache.get(key);
    if (!item) {
      const rect = content.getLocalBounds().rectangle;
      const x = Math.floor(rect.x), y = Math.floor(rect.y);
      const bounds = new Rectangle(x, y, Math.ceil(rect.x + rect.width) - x, Math.ceil(rect.y + rect.height) - y);
      const texture = RenderTexture.create({ width: bounds.width, height: bounds.height, resolution: 2, antialias: true });
      const composition = new Container(); content.position.set(-x, -y); composition.addChild(content);
      this.app.renderer.render({ container: composition, target: texture, clear: true });
      composition.removeChildren(); composition.destroy();
      item = { texture, bounds }; this.cache.set(key, item);
    }
    content.destroy({ children: true });
    const sprite = new Sprite({ texture: item.texture, label: "terrain-surface", eventMode: "none" });
    sprite.anchor.set(0); sprite.position.set(item.bounds.x, item.bounds.y);
    return sprite;
  }
  public finish(): void {
    for (const [key, item] of this.cache) if (!this.used.has(key)) { item.texture.destroy(true); this.cache.delete(key); }
  }
  public destroy(): void { for (const item of this.cache.values()) item.texture.destroy(true); this.cache.clear(); }
}
