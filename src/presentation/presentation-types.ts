import type { ActorDefinitionId, Direction, TraitInstance } from "../game/types";

export type PresentationAssetId = string;
export type PresentationAssetKind = "actor" | "terrain" | "object" | "ui";

export interface AssetPoint {
  readonly x: number;
  readonly y: number;
}

export interface PresentationAssetDefinition {
  readonly frame: string;
  readonly kind: PresentationAssetKind;
  readonly anchor: AssetPoint;
  readonly displayWidth?: number;
  readonly displayHeight?: number;
  readonly footprint?: { readonly width: number; readonly height: number };
}

export interface ActorVisualDefinition {
  readonly south: PresentationAssetId;
  readonly "south-west": PresentationAssetId;
  readonly west: PresentationAssetId;
  readonly "north-west": PresentationAssetId;
  readonly north: PresentationAssetId;
  readonly "north-east": PresentationAssetId;
  readonly east: PresentationAssetId;
  readonly "south-east": PresentationAssetId;
}

export interface PresentationAssetManifest {
  readonly version: 2;
  readonly bundle: string;
  readonly atlas: { readonly path: string };
  readonly assets: Readonly<Record<PresentationAssetId, PresentationAssetDefinition>>;
  readonly actorVisuals: Readonly<Record<ActorDefinitionId, ActorVisualDefinition>>;
  readonly terrainVisuals: {
    readonly open: PresentationAssetId;
    readonly difficult: PresentationAssetId;
    readonly impassable: PresentationAssetId;
    readonly web: PresentationAssetId;
    readonly blocked: PresentationAssetId;
  };
  readonly objectVisuals: {
    readonly lever: PresentationAssetId;
    readonly gateClosed: PresentationAssetId;
    readonly gateOpen: PresentationAssetId;
  };
}

export function groundSemantic(traits: readonly TraitInstance[]): "open" | "difficult" | "impassable" {
  if (traits.some((trait) => trait.id === "impassable")) return "impassable";
  if (traits.some((trait) => trait.id === "difficult")) return "difficult";
  return "open";
}

export interface PresentationTilemap {
  readonly width: number;
  readonly height: number;
  readonly palettes: {
    readonly ground: readonly PresentationAssetId[];
    readonly transitions: readonly PresentationAssetId[];
    readonly objects: readonly PresentationAssetId[];
  };
  readonly layers: {
    readonly ground: readonly number[];
    readonly transitions: readonly number[];
    readonly objects: readonly number[];
  };
  readonly meta: {
    readonly tileIds: readonly string[];
    readonly objectIds: readonly (string | null)[];
    readonly type: readonly string[];
    readonly walkable: readonly boolean[];
    readonly cost: readonly (number | null)[];
  };
}

export interface PresentationTilemapPack {
  readonly version: 1;
  readonly maps: Readonly<Record<string, PresentationTilemap>>;
}

export function facingAsset(visual: ActorVisualDefinition, direction: Direction): PresentationAssetId {
  return visual[direction];
}
