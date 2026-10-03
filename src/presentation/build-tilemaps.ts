import type { ScenarioSource } from "../content/content-types";
import type { TileState } from "../game/types";
import type { PresentationTilemap, PresentationTilemapPack } from "./presentation-types";

export interface CampaignScenery {
  readonly scenarioId: string;
  readonly visual: string;
  readonly cells: readonly (readonly [number, number])[];
}
export interface TilemapBuildStyle {
  readonly groundMaterials?: Readonly<Record<string, string>>;
  readonly objectVisuals: Readonly<Record<string, string>>;
  readonly scenery?: readonly CampaignScenery[];
}

function traitSet(tile: TileState): ReadonlySet<string> {
  return new Set(tile.traits.map((trait) => trait.id));
}

function semanticType(traits: ReadonlySet<string>): string {
  if (traits.has("gate") || traits.has("gate-open")) return "gate";
  if (traits.has("blocked")) return "blocked";
  if (traits.has("impassable")) return "impassable";
  if (traits.has("web")) return "web";
  if (traits.has("difficult")) return "difficult";
  return "open";
}

export function buildPresentationTilemaps(scenarios: readonly ScenarioSource[], style: TilemapBuildStyle): PresentationTilemapPack {
  const groundPalette = ["terrain.stone-floor", "terrain.rubble", "terrain.chasm", ...Object.values(style.groundMaterials ?? {})];
  const transitionPalette = ["transition.web"];
  // Point props only. A wall or a gate is the tile's own state, drawn as board surface
  // from the tile's traits at runtime, so neither takes a slot on the object layer.
  const objectPalette = [...new Set(["object.lever", "object.chest", ...(style.objectVisuals.cottage ? [style.objectVisuals.cottage] : []),
    ...(style.scenery ?? []).map(entry => style.objectVisuals[entry.visual]).filter((id): id is string => id !== undefined)])];
  const maps: Record<string, PresentationTilemap> = {};
  for (const scenario of scenarios) {
    const { width, height } = scenario.map;
    const length = width * height;
    const ground = new Array<number>(length).fill(-1);
    const transitions = new Array<number>(length).fill(-1);
    const objects = new Array<number>(length).fill(-1);
    const tileIds = new Array<string | null>(length).fill(null);
    const objectIds = new Array<string | null>(length).fill(null);
    const types = new Array<string>(length).fill("missing");
    const walkable = new Array<boolean>(length).fill(false);
    const costs = new Array<number | null>(length).fill(null);
    for (const tile of scenario.map.tiles) {
      const { x, y } = tile.position;
      if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= width || y >= height) {
        throw new Error(`${scenario.id} tile ${tile.id} is outside ${width}x${height}.`);
      }
      const index = y * width + x;
      if (tileIds[index] !== null) throw new Error(`${scenario.id} has duplicate tile position ${x},${y}.`);
      const traits = traitSet(tile);
      const material = Object.entries(style.groundMaterials ?? {}).find(([trait]) => traits.has(trait))?.[1];
      ground[index] = material ? groundPalette.indexOf(material) : traits.has("impassable") ? 2 : traits.has("difficult") ? 1 : 0;
      if (traits.has("web")) transitions[index] = 0;
      tileIds[index] = tile.id;
      objectIds[index] = (objects[index] ?? -1) >= 0 ? tile.id : null;
      types[index] = semanticType(traits);
      const isWalkable = !traits.has("blocked") && !traits.has("impassable") && !traits.has("gate");
      walkable[index] = isWalkable;
      costs[index] = isWalkable ? (traits.has("difficult") ? 2 : 1) : null;
    }
    for (const object of scenario.map.objects) {
      const index = object.position.y * width + object.position.x;
      if (index < 0 || index >= length) throw new Error(`${scenario.id} object ${object.id} is outside the map.`);
      if (object.traits.some((trait) => trait.id === "lever")) objects[index] = 0;
      objectIds[index] = object.id;
    }
    for (const dressing of style.scenery ?? []) {
      if (dressing.scenarioId !== scenario.id) continue;
      const assetId = style.objectVisuals[dressing.visual];
      const paletteIndex = assetId === undefined ? -1 : objectPalette.indexOf(assetId);
      if (paletteIndex < 0) throw new Error(`Scenery visual "${dressing.visual}" is not a placeable object.`);
      for (const [x, y] of dressing.cells) {
        if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= width || y >= height) {
          throw new Error(`Scenery for ${scenario.id} sits outside ${width}x${height}.`);
        }
        const index = y * width + x;
        // Dressing never covers something the scenario itself put there.
        if (objects[index] === -1) objects[index] = paletteIndex;
      }
    }
    if (tileIds.some((id) => id === null)) throw new Error(`${scenario.id} does not define every tile.`);
    maps[scenario.id] = {
      width,
      height,
      palettes: { ground: groundPalette, transitions: transitionPalette, objects: objectPalette },
      layers: { ground, transitions, objects },
      meta: { tileIds: tileIds as string[], objectIds, type: types, walkable, cost: costs },
    };
  }
  return { version: 1, maps };
}
