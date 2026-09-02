import type {
  ActionDefinition,
  ActionId,
  ActorStatProfile,
  ActorDefinitionId,
  BattleMapState,
  CardDefinition,
  CardDefinitionId,
  CardGrant,
  CombatContent,
  ConditionDefinition,
  ConditionInstance,
  Direction,
  EquipmentDefinition,
  EquipmentId,
  EquipmentSlotId,
  MapObjectState,
  ObjectiveDefinition,
  ScenarioDefinition,
  ScenarioId,
  TeamId,
  TileState,
  TraitDefinition,
  TraitInstance,
} from "../game/types";

export interface ContentPackManifest {
  readonly schemaVersion: 8;
  readonly id: string;
  readonly version: string;
  readonly rulesetId: string;
}

export interface ActorDefinition {
  readonly id: ActorDefinitionId;
  readonly name: string;
  readonly statProfile: ActorStatProfile;
  readonly speedFeet: number;
  readonly traits: readonly TraitInstance[];
  readonly loadoutProfile: LoadoutProfile;
  readonly starterLoadout: StarterLoadout;
  readonly innateActionIds: readonly ActionId[];
  readonly baseCardGrants: readonly CardGrant[];
  readonly initialConditions?: readonly ConditionInstance[];
}

export interface LoadoutProfile {
  readonly preparedCardCapacity: number;
}

export interface StarterLoadout {
  readonly equipment: Readonly<Partial<Record<EquipmentSlotId, EquipmentId>>>;
  readonly preparedCards: readonly CardDefinitionId[];
}

export type PartySizeNumber = 1 | 2 | 3;

export const PARTY_SIZES = [1, 2, 3] as const satisfies readonly PartySizeNumber[];

export interface EncounterActorPlacement {
  readonly instanceId: string;
  readonly actorDefinitionId: ActorDefinitionId;
  readonly team: TeamId;
  readonly position: { readonly x: number; readonly y: number };
  readonly facing: Direction;
  /**
   * Which party sizes this static Actor appears for. Absent means every size, so an
   * Encounter authored before this contract keeps exactly the composition it had.
   */
  readonly partySize?: { readonly min: PartySizeNumber; readonly max: PartySizeNumber };
}

/**
 * The single answer to "does this static Actor exist for a party of this size". The runtime
 * bridge, the compile-time preview and the validator all ask here, so a composition can
 * never be legal in one of them and not another.
 */
export function placementAppliesToPartySize(
  placement: EncounterActorPlacement,
  partySize: number,
): boolean {
  const range = placement.partySize;
  if (!range) return true;
  return partySize >= range.min && partySize <= range.max;
}

export interface PartySpawnSlot {
  readonly seat: 1 | 2 | 3;
  readonly position: { readonly x: number; readonly y: number };
  readonly facing: Direction;
}

export interface BattleMapSource {
  readonly width: number;
  readonly height: number;
  readonly tiles: readonly TileState[];
  readonly objects: readonly MapObjectState[];
}

export interface ScenarioSource {
  readonly id: ScenarioId;
  readonly name: string;
  readonly objective: ObjectiveDefinition;
  readonly placements: readonly EncounterActorPlacement[];
  readonly partySpawnSlots: readonly PartySpawnSlot[];
  readonly map: BattleMapSource;
}

export type RewardGrant =
  | { readonly kind: "equipment"; readonly definitionId: EquipmentId }
  | { readonly kind: "card"; readonly definitionId: CardDefinitionId };

export interface AdventureRewardDefinition {
  readonly id: string;
  readonly afterEncounterId: ScenarioId;
  readonly choices: readonly RewardGrant[];
}

export interface AdventureDefinition {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly partySize: {
    readonly min: 1 | 2 | 3;
    readonly max: 1 | 2 | 3;
  };
  readonly encounterIds: readonly ScenarioId[];
  readonly rewards: readonly AdventureRewardDefinition[];
}

export interface ContentPackSource {
  readonly manifest: ContentPackManifest;
  readonly traits: readonly TraitDefinition[];
  readonly conditions: readonly ConditionDefinition[];
  readonly actions: readonly ActionDefinition[];
  readonly cards: readonly CardDefinition[];
  readonly equipment: readonly EquipmentDefinition[];
  readonly actors: readonly ActorDefinition[];
  readonly scenarios: readonly ScenarioSource[];
  readonly adventures: readonly AdventureDefinition[];
}

export interface CompiledContentPack {
  readonly manifest: ContentPackManifest;
  readonly fingerprint: string;
  readonly combatContent: CombatContent;
  readonly actorDefinitions: Readonly<Record<ActorDefinitionId, ActorDefinition>>;
  readonly scenarioSources: Readonly<Record<ScenarioId, ScenarioSource>>;
  readonly scenarios: Readonly<Record<ScenarioId, ScenarioDefinition>>;
  readonly adventures: Readonly<Record<string, AdventureDefinition>>;
}

export type ContentSourceCategory =
  | "manifest"
  | "traits"
  | "conditions"
  | "actions"
  | "cards"
  | "equipment"
  | "actors"
  | "scenarios"
  | "adventures";

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
  readonly scenarios: unknown;
  readonly adventures: unknown;
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
    scenarios: files.scenarios,
    adventures: files.adventures,
  };
}

export type { BattleMapState };
