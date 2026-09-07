import { describe, expect, it } from "vitest";

import atlasMapJson from "../../presentation/m3/atlas-map.json";
import { createPresentationCatalog } from "./asset-catalog";
import { facingStandee } from "./presentation-types";
import type { PresentationAtlasMap } from "./presentation-types";

const catalog = createPresentationCatalog();
const atlasFrames = (atlasMapJson as unknown as PresentationAtlasMap).frames;
const entries = Object.entries(catalog.manifest.assets);
const actorIds = entries.filter(([, asset]) => asset.kind === "actor").map(([id]) => id);
const otherIds = entries.filter(([, asset]) => asset.kind !== "actor").map(([id]) => id);

describe("presentation asset storage", () => {
  it("keeps every tile, prop and UI asset in the shared atlas", () => {
    expect(otherIds.length).toBeGreaterThan(0);
    for (const id of otherIds) {
      const source = catalog.asset(id).source;
      expect(source).toEqual({ type: "atlas", frame: id });
    }
  });

  it("gives every actor a standalone runtime image under the actor namespace", () => {
    expect(actorIds.length).toBeGreaterThan(0);
    for (const id of actorIds) {
      const source = catalog.asset(id).source;
      expect(source.type).toBe("image");
      if (source.type !== "image") return;
      // The full definition namespace is in the path, so hero.aerin and a future
      // enemy.aerin cannot land on the same file.
      expect(source.path).toMatch(/^\/assets\/actors\/[a-z0-9-]+\/[a-z0-9-]+\/(front|back)\.webp$/);
      expect({ width: source.width, height: source.height }).toEqual({ width: 256, height: 384 });
    }
  });

  it("partitions the manifest into exactly the atlas frames plus the standalone actors", () => {
    // The invariant the old checker got from `manifest IDs == atlas frame IDs`, restated
    // now that one logical namespace spans two stores.
    expect(Object.keys(atlasFrames).sort()).toEqual([...otherIds].sort());
    for (const id of actorIds) expect(atlasFrames[id]).toBeUndefined();
  });

  it("still paints tilemaps out of assets the atlas actually holds", () => {
    for (const [scenarioId, map] of Object.entries(catalog.tilemaps.maps)) {
      for (const palette of Object.values(map.palettes)) {
        for (const id of palette) {
          expect(atlasFrames[id], `${scenarioId} palette ${id}`).toBeDefined();
        }
      }
    }
  });
});

describe("actor visuals across the split", () => {
  it("keeps front and back as logical asset IDs of actor kind", () => {
    for (const [definitionId, visual] of Object.entries(catalog.manifest.actorVisuals)) {
      for (const side of [visual.front, visual.back]) {
        expect(catalog.asset(side).kind, `${definitionId} ${side}`).toBe("actor");
      }
    }
  });

  it("resolves north to the back drawing and the other cardinals to the front", () => {
    const visual = catalog.actorVisual("hero.aerin");
    expect(facingStandee(visual, "north")).toEqual({ assetId: visual.back, flipX: false });
    expect(facingStandee(visual, "west")).toEqual({ assetId: visual.back, flipX: true });
    expect(facingStandee(visual, "east")).toEqual({ assetId: visual.front, flipX: false });
    expect(facingStandee(visual, "south")).toEqual({ assetId: visual.front, flipX: true });
  });
});

describe("DOM styles read whichever store an asset lives in", () => {
  it("points an actor portrait at the actor's own file, never the atlas", () => {
    const visual = catalog.actorVisual("hero.aerin");
    const source = catalog.asset(visual.front).source;
    if (source.type !== "image") throw new Error("hero.aerin front should be standalone.");
    for (const style of [
      catalog.domStandeeStyle(visual.front, 132),
      catalog.domPortraitStyle(visual.front, 92),
    ]) {
      expect(style.backgroundImage).toBe(`url("${source.path}")`);
      expect(style.backgroundImage).not.toContain("m3-atlas");
    }
  });

  it("keeps a standee's own proportions when sized by height", () => {
    const visual = catalog.actorVisual("hero.aerin");
    // 256x384 art at 132px tall is 88px wide: the frame is the whole file, so nothing
    // has to be offset out of a sheet first.
    const style = catalog.domStandeeStyle(visual.front, 132);
    expect(style).toMatchObject({
      backgroundPosition: "0px 0px",
      backgroundSize: "88px 132px",
      width: "88px",
      height: "132px",
    });
  });

  it("crops a portrait square inside the standalone file, not inside a sheet", () => {
    const visual = catalog.actorVisual("hero.aerin");
    const style = catalog.domPortraitStyle(visual.front, 96);
    expect(style.width).toBe("96px");
    expect(style.height).toBe("96px");
    // A bust crop starts at the top of the ink, so the background is pulled up and left.
    const [x, y] = style.backgroundPosition.split(" ");
    expect(Number.parseFloat(x ?? "")).toBeLessThanOrEqual(0);
    expect(Number.parseFloat(y ?? "")).toBeLessThan(0);
  });

  it("still places an atlas-backed asset out of the shared sheet", () => {
    const cardId = catalog.cardVisual("card.trip");
    if (!cardId) throw new Error("card.trip should have a visual.");
    const frame = atlasFrames[cardId]?.frame;
    if (!frame) throw new Error(`${cardId} should be an atlas frame.`);
    const atlas = catalog.manifest.atlas;
    expect(catalog.domAssetStyle(cardId, 48)).toEqual({
      backgroundImage: `url("${atlas.imagePath}")`,
      backgroundPosition: `${-frame.x * (48 / frame.w)}px ${-frame.y * (48 / frame.h)}px`,
      backgroundSize: `${atlas.width * (48 / frame.w)}px ${atlas.height * (48 / frame.h)}px`,
      width: "48px",
      height: "48px",
    });
    expect(catalog.domFillStyle(cardId).backgroundImage).toBe(`url("${atlas.imagePath}")`);
  });

  it("refuses a size that would divide by nothing", () => {
    const visual = catalog.actorVisual("hero.aerin");
    expect(() => catalog.domStandeeStyle(visual.front, 0)).toThrow(/must be positive/);
    expect(() => catalog.domPortraitStyle(visual.front, -1)).toThrow(/must be positive/);
    expect(() => catalog.domAssetStyle("ui.card.trip", Number.NaN)).toThrow(/must be positive/);
  });
});
