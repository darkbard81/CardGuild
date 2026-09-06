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
  /**
   * Where the drawing sits inside its frame, as fractions of the frame. Measured by the
   * asset build so a portrait can frame the top of the art instead of the top of the
   * canvas — a low, wide creature leaves that empty.
   */
  readonly ink?: {
    readonly top: number;
    readonly left: number;
    readonly width: number;
    readonly height: number;
  };
}

export interface ActorVisualDefinition {
  readonly front: PresentationAssetId;
  readonly back: PresentationAssetId;
}

export interface PresentationAssetManifest {
  readonly version: 4;
  readonly bundle: string;
  readonly atlas: {
    readonly path: string;
    readonly imagePath: string;
    readonly width: number;
    readonly height: number;
  };
  readonly assets: Readonly<Record<PresentationAssetId, PresentationAssetDefinition>>;
  readonly actorVisuals: Readonly<Record<ActorDefinitionId, ActorVisualDefinition>>;
  /**
   * What a tile's own state looks like. The last three are surfaces a square can be in
   * rather than things standing on it — a wall, and a gate in each of its two states —
   * so they are square terrain tiles like the floors, not standees.
   */
  readonly terrainVisuals: {
    readonly open: PresentationAssetId;
    readonly difficult: PresentationAssetId;
    readonly impassable: PresentationAssetId;
    readonly web: PresentationAssetId;
    readonly blocked: PresentationAssetId;
    readonly gateClosed: PresentationAssetId;
    readonly gateOpen: PresentationAssetId;
  };
  /** Point props: things standing on a tile that the tile would still be there without. */
  readonly objectVisuals: {
    readonly chest: PresentationAssetId;
    readonly lever: PresentationAssetId;
  };
  readonly equipmentVisuals: Readonly<Record<string, PresentationAssetId>>;
  readonly cardVisuals: Readonly<Record<string, PresentationAssetId>>;
}

export interface PresentationAtlasFrame {
  readonly frame: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
}

export interface PresentationAtlasMap {
  readonly frames: Readonly<Record<string, PresentationAtlasFrame>>;
  readonly meta: { readonly size: { readonly w: number; readonly h: number } };
}

export interface DomAtlasStyle {
  readonly backgroundImage: string;
  readonly backgroundPosition: string;
  readonly backgroundSize: string;
  readonly width: string;
  readonly height: string;
}

/** The same frame expressed in percentages, so it scales with whatever element holds it. */
export interface DomAtlasFillStyle {
  readonly backgroundImage: string;
  readonly backgroundPosition: string;
  readonly backgroundSize: string;
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

/** Which drawing a standee shows, and whether it is mirrored to get there. */
export interface StandeeFacing {
  readonly assetId: PresentationAssetId;
  readonly flipX: boolean;
}

/**
 * Four facings out of the two drawings that exist, paired by which way they point on the
 * turned board. A quarter turn puts north up-right and west up-left, so both face away
 * from the player and take the back drawing; east runs down-right and south down-left,
 * so both face towards the player and take the front. Within each pair the second is the
 * first seen in a mirror, which is what carries the pose to the other side of the screen.
 *
 *   north -> back            west  -> back mirrored
 *   east  -> front           south -> front mirrored
 *
 * Only the body is ever mirrored. A base, an HP badge or any text above a standee is
 * screen furniture and reads the same way whichever way the character looks.
 */
export function facingStandee(visual: ActorVisualDefinition, direction: Direction): StandeeFacing {
  if (direction === "north") return { assetId: visual.back, flipX: false };
  if (direction === "west") return { assetId: visual.back, flipX: true };
  return { assetId: visual.front, flipX: direction === "south" };
}
