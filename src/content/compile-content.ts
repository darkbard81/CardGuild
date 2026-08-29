import { positionKey } from "../game/grid";
import type { ActorSetup, CombatDefinition, ContentIdentity, ScenarioDefinition } from "../game/types";
import type {
  ActorDefinition,
  CompiledContentPack,
  ContentPackSource,
  ContentSourceLocations,
  ContentValidationIssue,
  EncounterActorPlacement,
  ScenarioSource,
} from "./content-types";
import { fingerprintContentPack, normalizeContentPack } from "./fingerprint";
import { validateContentPackSemantics } from "./validate-semantics";

export class ContentCompilationError extends Error {
  public readonly issues: readonly ContentValidationIssue[];

  public constructor(issues: readonly ContentValidationIssue[]) {
    super(`Content compilation failed with ${issues.length} validation issue${issues.length === 1 ? "" : "s"}.`);
    this.name = "ContentCompilationError";
    this.issues = issues;
  }
}

function recordById<T extends { readonly id: string }>(values: readonly T[]): Readonly<Record<string, T>> {
  return Object.fromEntries([...values].sort((left, right) => left.id.localeCompare(right.id)).map((value) => [value.id, value]));
}

export function buildActorSetup(
  definition: ActorDefinition,
  placement: EncounterActorPlacement,
  equipmentIds: readonly string[] = definition.equipmentIds,
): ActorSetup {
  return {
    id: placement.instanceId,
    definitionId: definition.id,
    name: definition.name,
    team: placement.team,
    position: { ...placement.position },
    facing: placement.facing,
    hp: definition.hp,
    maxHp: definition.maxHp,
    baseAc: definition.baseAc,
    reflexModifier: definition.reflexModifier,
    athleticsModifier: definition.athleticsModifier,
    initiativeModifier: definition.initiativeModifier,
    speedFeet: definition.speedFeet,
    fallbackWeapon: { ...definition.fallbackWeapon, damage: { ...definition.fallbackWeapon.damage } },
    conditions: (definition.initialConditions ?? []).map((condition) => ({ ...condition })),
    traits: definition.traits.map((trait) => ({ ...trait, params: trait.params ? { ...trait.params } : undefined })),
    equipmentIds: [...equipmentIds],
    innateActionIds: [...definition.innateActionIds],
    baseCardGrants: definition.baseCardGrants.map((grant) => ({ ...grant })),
  };
}

export function compileScenario(
  source: ScenarioSource,
  actorDefinitions: Readonly<Record<string, ActorDefinition>>,
): ScenarioDefinition {
  return {
    id: source.id,
    name: source.name,
    objective: { ...source.objective },
    actors: source.placements.map((placement) => {
      const definition = actorDefinitions[placement.actorDefinitionId];
      if (!definition) throw new Error(`Actor definition "${placement.actorDefinitionId}" is not present.`);
      return buildActorSetup(definition, placement);
    }),
    map: {
      width: source.map.width,
      height: source.map.height,
      tiles: Object.fromEntries(source.map.tiles.map((tile) => [positionKey(tile.position), tile])),
      objects: recordById(source.map.objects),
    },
  };
}

export function compileContentPack(
  source: ContentPackSource,
  locations: ContentSourceLocations = {},
): CompiledContentPack {
  const issues = validateContentPackSemantics(source, locations);
  if (issues.length > 0) throw new ContentCompilationError(issues);

  const normalized = normalizeContentPack(source);
  const actorDefinitions = recordById(normalized.actors);
  const scenarios = recordById(normalized.scenarios.map((scenario) => compileScenario(scenario, actorDefinitions)));

  return {
    manifest: normalized.manifest,
    fingerprint: fingerprintContentPack(normalized),
    combatContent: {
      actions: recordById(normalized.actions),
      cards: recordById(normalized.cards),
      equipment: recordById(normalized.equipment),
      traits: recordById(normalized.traits),
      conditions: recordById(normalized.conditions),
    },
    actorDefinitions,
    scenarioSources: recordById(normalized.scenarios),
    scenarios,
    adventures: recordById(normalized.adventures),
  };
}

export function getContentIdentity(pack: CompiledContentPack): ContentIdentity {
  return {
    packId: pack.manifest.id,
    packVersion: pack.manifest.version,
    fingerprint: pack.fingerprint,
  };
}

export function getCombatDefinition(pack: CompiledContentPack, scenarioId: string): CombatDefinition {
  const scenario = pack.scenarios[scenarioId];
  if (!scenario) throw new Error(`Scenario "${scenarioId}" is not present in content pack "${pack.manifest.id}".`);
  return {
    scenario,
    content: pack.combatContent,
    contentIdentity: getContentIdentity(pack),
  };
}
