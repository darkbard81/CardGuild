import type { AssetCatalog } from "../../presentation";
import { type Application, Container, Graphics, Rectangle, RenderTexture, Texture } from "pixi.js";
import { MAX_TERRAIN_ELEVATION, TERRAIN_ELEVATION_STEP } from "../../presentation/terrain-elevation";

/** Long, non-repeating material sheets. Faces crop from y=0; vertical texel density never changes. */
export class TerrainSideTextures {
  private readonly textures = new Map<string, RenderTexture>();
  private readonly crops = new Map<string, Texture>();
  public constructor(private readonly app: Application, private readonly catalog: AssetCatalog) {}
  public crop(material: string, pixels: number): Texture {
    if (!Number.isInteger(pixels) || pixels <= 0 || pixels > MAX_TERRAIN_ELEVATION * TERRAIN_ELEVATION_STEP) throw new Error("Invalid terrain side crop.");
    const key = `${material}:${pixels}`;
    let result = this.crops.get(key);
    if (!result) {
      const source = this.catalog.terrainSideTexture(material) ?? this.texture(material);
      result = new Texture({ source: source.source, frame: new Rectangle(0, 0, 128, pixels) });
      this.crops.set(key, result);
    }
    return result;
  }
  public texture(material: string): RenderTexture {
    const cached = this.textures.get(material);
    if (cached) return cached;
    const palette = material.includes("chasm") ? [0x34332d, 0x252621, 0x48463b]
      : material.includes("rubble") ? [0x706d5c, 0x5c5b4f, 0x89836c]
      : material.includes("gate") ? [0x696453, 0x555447, 0x80765d]
      : material.includes("wall") ? [0x7b7867, 0x656253, 0x99927b]
      : [0x888273, 0x716c5d, 0xa29a86];
    const height = MAX_TERRAIN_ELEVATION * TERRAIN_ELEVATION_STEP;
    const texture = RenderTexture.create({ width: 128, height, resolution: 1, antialias: true });
    const container = new Container();
    const drawing = new Graphics().rect(0, 0, 128, height).fill(palette[1]!);
    // Different widths/heights at every depth: one continuous rock column, not stacked copies.
    let seed = [...material].reduce((value, char) => (value * 31 + char.charCodeAt(0)) >>> 0, 19);
    const random = (): number => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    for (let y = 0; y < height;) {
      const band = 12 + Math.floor(random() * 23);
      for (let x = -Math.floor(random() * 28); x < 128;) {
        const width = 20 + Math.floor(random() * 42);
        drawing.poly([x + 1, y + 1, x + width - 2, y + 2, x + width - 1, y + band - 2, x + 2, y + band - 1]).fill(palette[Math.floor(random() * palette.length)]!);
        drawing.moveTo(x + 3, y + 3).lineTo(x + width - 3, y + 3).stroke({ color: 0xc1b79a, alpha: 0.16, width: 1 });
        x += width;
      }
      y += band;
    }
    for (let i = 0; i < 260; i++) drawing.circle(random() * 128, random() * height, 0.3 + random()).fill({ color: random() > 0.5 ? 0x201f1b : 0xc5bba4, alpha: 0.22 });
    container.addChild(drawing);
    this.app.renderer.render({ container, target: texture, clear: true });
    container.destroy({ children: true });
    this.textures.set(material, texture);
    return texture;
  }
  public destroy(): void { for (const crop of this.crops.values()) crop.destroy(); this.crops.clear(); for (const texture of this.textures.values()) texture.destroy(true); this.textures.clear(); }
}
