import { expect, it } from "vitest";
import { Point } from "pixi.js";
import { createPresentationCatalog } from "../../src/presentation";
import { applyTerrainElevations, elevationAt, exposedTerrainFaces, terrainSideMaterials } from "../../src/presentation/terrain-elevation";
import { BoardProjection } from "../../src/pixi/battle/BoardProjection";

it("G-ELEVATION legacy maps remain zero; heights round-trip independently of terrain and combat saves", () => {
  const pack = createPresentationCatalog().tilemaps;
  const id = "encounter.guild-practice";
  const original = pack.maps[id]!;
  expect(elevationAt(original, 1, 1)).toBe(0);
  const values = [0, 1, 2, 4, 4, 1, 0, 2, 4];
  const document = JSON.parse(JSON.stringify({ version: 1, maps: { [id]: values } }));
  const changed = applyTerrainElevations(pack, document).maps[id]!;
  expect(changed.meta.elevations).toEqual(values);
  expect(changed.layers).toEqual(original.layers);
  expect(original.meta.elevations).toBeUndefined();
  expect(exposedTerrainFaces(changed, 1, 1)).toEqual({ left: 2, right: 3 });
  expect(exposedTerrainFaces(changed, 0, 1)).toEqual({ left: 4, right: 0 });
  expect(exposedTerrainFaces(changed, 2, 2)).toEqual({ left: 4, right: 4 });
  expect(exposedTerrainFaces(changed, 0, 0)).toEqual({ left: 0, right: 0 });
  for (const bad of [null, { version: 2, maps: {} }, { version: 1, maps: { missing: [] } },
    { version: 1, maps: { [id]: [1] } }, ...[-1, 0.5, 9, NaN, "2"].map(value => ({ version: 1, maps: { [id]: new Array(9).fill(value) } }))]) {
    expect(() => applyTerrainElevations(pack, bad)).toThrow();
  }
});

it("G-ELEVATION raised top corners, picking, hidden sides and pan/zoom share the same geometry", () => {
  for (const scale of [0.5, 1, 2]) for (const height of [0, 1, 2, 4]) {
    const projection = new BoardProjection();
    projection.update(3, 3, { originX: 413, originY: 377, scale });
    projection.setElevations([0, 0, 0, 0, height, 0, 0, 0, 0]);
    const point = projection.surfaceToScreen(1.5, 1.5);
    expect(point.x).toBeCloseTo(413);
    expect(point.y).toBeCloseTo(377 - height * 32 * scale);
    expect(projection.pickSurface(point.x, point.y)).toEqual({ x: 1, y: 1 });
    const logical = projection.screenToSurfaceGrid(point.x, point.y);
    expect(logical.x).toBeCloseTo(1.5); expect(logical.y).toBeCloseTo(1.5);
    if (height) {
      const corners = projection.getCellCorners(1, 1);
      const side = new Point((corners[3]!.x + corners[2]!.x) / 2, (corners[3]!.y + corners[2]!.y) / 2 + height * 16 * scale);
      expect(projection.pickSurface(side.x, side.y)).toBeNull();
    }
    expect(projection.pickSurface(-1000, -1000)).toBeNull();
    expect(projection.interpolatedElevation(1, 1.5)).toBe(height / 2);
  }
});

it("G-ELEVATION standalone side materials accept only known terrain and local PNG/WebP paths", () => {
  const assets = { "terrain.stone-floor": { kind: "terrain" }, hero: { kind: "actor" } };
  expect(terrainSideMaterials({ version: 1, materials: { "terrain.stone-floor": "/assets/terrain-sides/stone.png" } }, assets))
    .toEqual({ "terrain.stone-floor": "/assets/terrain-sides/stone.png" });
  for (const input of [{ version: 2, materials: {} }, { version: 1, materials: { hero: "/assets/hero.png" } },
    { version: 1, materials: { missing: "/assets/a.png" } },
    ...["https://example.com/a.png", "/assets/../a.png", "/assets/a.svg"].map(path => ({ version: 1, materials: { "terrain.stone-floor": path } }))])
    expect(() => terrainSideMaterials(input, assets)).toThrow();
});
