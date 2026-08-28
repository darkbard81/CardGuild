import { positionKey } from "../game/grid";
import type { CombatDefinition, ContentIdentity, ScenarioDefinition } from "../game/types";
import type {
  CompiledContentPack,
  ContentPackSource,
  ContentSourceLocations,
  ContentValidationIssue,
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

export function compileContentPack(
  source: ContentPackSource,
  locations: ContentSourceLocations = {},
): CompiledContentPack {
  const issues = validateContentPackSemantics(source, locations);
  if (issues.length > 0) throw new ContentCompilationError(issues);

  const normalized = normalizeContentPack(source);
  const actorById = recordById(normalized.actors);
  const scenario: ScenarioDefinition = {
    id: normalized.scenario.id,
    name: normalized.scenario.name,
    objective: normalized.scenario.objective,
    actors: normalized.scenario.actorIds.map((actorId) => actorById[actorId] as NonNullable<(typeof actorById)[string]>),
    map: {
      width: normalized.scenario.map.width,
      height: normalized.scenario.map.height,
      tiles: Object.fromEntries(normalized.scenario.map.tiles.map((tile) => [positionKey(tile.position), tile])),
      objects: recordById(normalized.scenario.map.objects),
    },
  };

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
    scenarios: { [scenario.id]: scenario },
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
