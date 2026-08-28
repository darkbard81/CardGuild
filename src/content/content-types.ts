import type {
  ActionDefinition,
  ActorSetup,
  BattleMapState,
  CardDefinition,
  CombatContent,
  ConditionDefinition,
  EquipmentDefinition,
  MapObjectState,
  ScenarioDefinition,
  TileState,
  TraitDefinition,
} from "../game/types";

export interface ContentPackManifest {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly version: string;
  readonly rulesetId: string;
}

export interface BattleMapSource {
  readonly width: number;
  readonly height: number;
  readonly tiles: readonly TileState[];
  readonly objects: readonly MapObjectState[];
}

export interface ScenarioSource {
  readonly id: string;
  readonly name: string;
  readonly objective: string;
  readonly actorIds: readonly string[];
  readonly map: BattleMapSource;
}

export interface ContentPackSource {
  readonly manifest: ContentPackManifest;
  readonly traits: readonly TraitDefinition[];
  readonly conditions: readonly ConditionDefinition[];
  readonly actions: readonly ActionDefinition[];
  readonly cards: readonly CardDefinition[];
  readonly equipment: readonly EquipmentDefinition[];
  readonly actors: readonly ActorSetup[];
  readonly scenario: ScenarioSource;
}

export interface CompiledContentPack {
  readonly manifest: ContentPackManifest;
  readonly fingerprint: string;
  readonly combatContent: CombatContent;
  readonly scenarios: Readonly<Record<string, ScenarioDefinition>>;
}

export type ContentSourceCategory =
  | "manifest"
  | "traits"
  | "conditions"
  | "actions"
  | "cards"
  | "equipment"
  | "actors"
  | "scenario";

export type ContentSourceLocations = Readonly<Partial<Record<ContentSourceCategory, string>>>;

export interface ContentValidationIssue {
  readonly packId?: string;
  readonly source: string;
  readonly path: string;
  readonly definitionId?: string;
  readonly code: string;
  readonly message: string;
}

export interface ContentPackFiles {
  readonly manifest: unknown;
  readonly traits: unknown;
  readonly conditions: unknown;
  readonly actions: unknown;
  readonly cards: unknown;
  readonly equipment: unknown;
  readonly actors: unknown;
  readonly scenario: unknown;
}

export function assembleContentPackSource(files: ContentPackFiles): unknown {
  return {
    manifest: files.manifest,
    traits: files.traits,
    conditions: files.conditions,
    actions: files.actions,
    cards: files.cards,
    equipment: files.equipment,
    actors: files.actors,
    scenario: files.scenario,
  };
}

export type { BattleMapState };
