import { type Application, Container, Sprite, Texture } from "pixi.js";
import { TerrainColumnTextures } from "../../src/pixi/battle/TerrainColumnTextures";
import { expect, it } from "vitest";
import { foregroundStandeeRectangles, overlaps, subtractRectangles, unionRectangles } from "../../src/pixi/battle/StandeeOcclusion";

it("G-STANDEE foreground terrain uses every overlapping actor rectangle and the exact draw-order tie break", () => {
  const bounds = { x: 0, y: 0, width: 100, height: 100 };
  const first = { x: 10, y: 20, width: 40, height: 60 };
  const second = { x: 30, y: 15, width: 30, height: 55 };
  const terrain = { bounds, depth: { zIndex: 20, label: "terrain" } };
  const actor = (rectangle: typeof bounds, zIndex: number, label = "actor") => ({ bounds: rectangle, depth: { zIndex, label } });
  expect(foregroundStandeeRectangles(terrain, [actor(first, 10), actor(second, 10)])).toEqual([first, second]);
  expect(foregroundStandeeRectangles(terrain, [actor(first, 30)])).toEqual([]);
  expect(foregroundStandeeRectangles(terrain, [actor(first, 20)])).toEqual([first]);
  expect(foregroundStandeeRectangles(terrain, [actor(first, 20, "z-last")])).toEqual([]);
  expect(foregroundStandeeRectangles(terrain, [actor({ ...first, x: 100 }, 10)])).toEqual([]);
});

it("G-STANDEE overlapping full rectangles partition into one transparent area and its opaque complement", () => {
  const base = { x: 0, y: 0, width: 100, height: 100 };
  const a = { x: 10, y: 10, width: 40, height: 40 }, b = { x: 30, y: 20, width: 40, height: 40 };
  const inside = unionRectangles([a, b, { x: 30, y: 20, width: 10, height: 10 }]);
  const outside = subtractRectangles(base, inside);
  const area = (rectangles: readonly typeof base[]) => rectangles.reduce((total, rect) => total + rect.width * rect.height, 0);
  expect(area(inside)).toBe(2600); expect(area(outside)).toBe(7400);
  const all = [...inside, ...outside];
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) expect(overlaps(all[i]!, all[j]!)).toBe(false);
  expect(subtractRectangles(base, [{ x: -10, y: -10, width: 120, height: 120 }])).toEqual([]);
  expect(subtractRectangles(base, [])).toEqual([base]);
});

it("G-STANDEE static terrain reuses one texture across actor/camera frames and releases changed/retired columns", () => {
  let renders = 0;
  const cache = new TerrainColumnTextures({ renderer: { render: () => { renders++; } } } as unknown as Application);
  const surface = () => { const container = new Container(); const sprite = new Sprite(Texture.WHITE); sprite.setSize(128, 64); container.addChild(sprite); return container; };
  cache.begin(); const first = cache.sprite("stone:4", surface()); cache.finish();
  const source = first.texture.source; first.destroy();
  cache.begin(); const moving = cache.sprite("stone:4", surface()); cache.finish();
  expect(moving.texture.source).toBe(source); expect(renders).toBe(1); moving.destroy();
  cache.begin(); const heightChanged = cache.sprite("stone:2", surface()); cache.finish();
  expect(renders).toBe(2); expect(source.destroyed).toBe(true);
  const next = heightChanged.texture.source; heightChanged.destroy();
  cache.begin(); const materialChanged = cache.sprite("rubble:2", surface()); cache.finish();
  expect(renders).toBe(3); expect(next.destroyed).toBe(true);
  const last = materialChanged.texture.source; materialChanged.destroy();
  cache.begin(); cache.finish(); // Returning to a flat map retires all elevated columns.
  expect(last.destroyed).toBe(true);
  cache.destroy();
  expect(last.destroyed).toBe(true);
});
