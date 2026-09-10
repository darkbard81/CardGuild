import { compileScenario } from "../../../src/content/compile-content";
import { normalizeContentPack } from "../../../src/content/fingerprint";
import type { ContentPackSource, ScenarioSource } from "../../../src/content";
import { fingerprintValue } from "../../../src/game";
import type { ActorDefinitionId, CombatContent, CombatDefinition, ContentIdentity } from "../../../src/game";
import type { LoadoutContent } from "../../../src/loadout";
import { CHARACTER_RULES_DEFINITIONS } from "./character-rules";
import { CORE_DEFINITIONS, RUINED_GATE_ID } from "./core";
import { CHARACTER_RULES_PACK_ID, CORE_PACK_ID, FIXTURE_PACK_VERSION, fixtureManifest } from "./identity";

export {
  CORE_DEFINITIONS,
  CORE_SCENARIOS,
  FIXTURE_ADVENTURE_ID,
  GOBLIN_CHIEF_ID,
  ROAD_AMBUSH_ID,
  RUINED_GATE_ID,
} from "./core";
export { CHARACTER_RULES_PACK_ID, CORE_PACK_ID, FIXTURE_PACK_VERSION, fixtureManifest } from "./identity";
export { JSON_PACK_ID, createJsonPackFiles, createJsonPackSource } from "./json-pack";

/** Which rule set a fixture is built from. */
export type FixtureRules = "core" | "character-rules";

function byId<T extends { readonly id: string }>(values: readonly T[]): Readonly<Record<string, T>> {
  return Object.fromEntries([...values]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((value) => [value.id, value]));
}

/**
 * A fresh, independent copy of everything a factory hands out.
 *
 * The definitions are module-level constants, so without this one test that pokes at a
 * nested Trait array would be editing what every later test reads. Deep-cloning at the
 * factory boundary is the only place that can be guaranteed once rather than remembered
 * at each call site.
 */
function fresh<T>(value: T): T {
  return structuredClone(value) as T;
}

/**
 * The definitions as authored, in the order a person wrote them.
 *
 * Source factories hand this out unchanged: a schema or semantic test that reaches for
 * `actors[0]` is reaching for the hero someone put first, and sorting it out from under
 * them would make those tests silently about a different definition.
 */
function definitionsFor(rules: FixtureRules): Omit<ContentPackSource, "manifest"> {
  return rules === "core"
    ? CORE_DEFINITIONS
    : { ...CORE_DEFINITIONS, ...CHARACTER_RULES_DEFINITIONS };
}

const CANONICAL = new Map<FixtureRules, Omit<ContentPackSource, "manifest">>();

/**
 * The same definitions in canonical order.
 *
 * A compiled pack holds normalized content, so normalizing here is what makes a battle
 * assembled by hand and a battle compiled from the same source the *same* object graph
 * rather than merely an equivalent one — down to the order tiles are keyed in.
 */
function canonicalDefinitionsFor(rules: FixtureRules): Omit<ContentPackSource, "manifest"> {
  const cached = CANONICAL.get(rules);
  if (cached) return cached;
  const normalized = normalizeContentPack({ manifest: fixtureManifest(rules), ...definitionsFor(rules) });
  const definitions: Omit<ContentPackSource, "manifest"> = {
    traits: normalized.traits,
    conditions: normalized.conditions,
    actions: normalized.actions,
    cards: normalized.cards,
    equipment: normalized.equipment,
    actors: normalized.actors,
    scenarios: normalized.scenarios,
    adventures: normalized.adventures,
  };
  CANONICAL.set(rules, definitions);
  return definitions;
}

function combatContentOf(definitions: Omit<ContentPackSource, "manifest">): CombatContent {
  return {
    actions: byId(definitions.actions),
    cards: byId(definitions.cards),
    equipment: byId(definitions.equipment),
    traits: byId(definitions.traits),
    conditions: byId(definitions.conditions),
  };
}

function loadoutContentOf(rules: FixtureRules): LoadoutContent {
  const definitions = fresh(canonicalDefinitionsFor(rules));
  return {
    actorDefinitions: byId(definitions.actors) as LoadoutContent["actorDefinitions"],
    combatContent: combatContentOf(definitions),
  };
}

/**
 * The base rules: one Character, the tactical Action set, and the equipment and terrain the
 * combat, loadout and adventure rules are all written against.
 */
export function createCoreRulesFixture(): LoadoutContent {
  return loadoutContentOf("core");
}

/**
 * The core rules plus the three playable Characters and the weapon, armor and spell
 * vocabulary that only matters once a player is choosing between them.
 */
export function createCharacterRulesFixture(): LoadoutContent {
  return loadoutContentOf("character-rules");
}

/**
 * The identity a combat fixture carries.
 *
 * It is fingerprinted from the combat content itself rather than from a compiled pack,
 * because that is all this fixture is: a battle needs Actions, cards, equipment, Traits and
 * Conditions, and nothing about an Adventure. Two fixtures that would fight identically
 * therefore share an identity, and one rule change moves it.
 */
function combatIdentity(rules: FixtureRules, content: CombatContent): ContentIdentity {
  return {
    packId: rules === "core" ? CORE_PACK_ID : CHARACTER_RULES_PACK_ID,
    packVersion: FIXTURE_PACK_VERSION,
    fingerprint: fingerprintValue(content),
  };
}

export interface TacticalCombatFixtureOptions {
  readonly rules?: FixtureRules;
  readonly scenarioId?: string;
}

/**
 * One battle, assembled from only what a battle needs.
 *
 * No pack is compiled and no Adventure exists here. The scenario goes through the same
 * conversion a compiled pack uses, so what a test fights on is what the compiler would have
 * produced — `content.test.ts` holds that equivalence — but the fixture stays a battle
 * rather than a release.
 */
export function createTacticalCombatFixture(
  options: TacticalCombatFixtureOptions = {},
): CombatDefinition {
  const rules = options.rules ?? "core";
  const definitions = fresh(canonicalDefinitionsFor(rules));
  const scenarioId = options.scenarioId ?? RUINED_GATE_ID;
  const source: ScenarioSource | undefined = definitions.scenarios.find((entry) => entry.id === scenarioId);
  if (!source) throw new Error(`Fixture scenario "${scenarioId}" is not defined.`);
  const content = combatContentOf(definitions);
  const actorDefinitions = byId(definitions.actors);
  return {
    scenario: compileScenario(source, actorDefinitions, content),
    content,
    contentIdentity: combatIdentity(rules, content),
  };
}

/** The Actor ids a tactical fixture places, for tests that name one. */
export const FIXTURE_HERO_ID = "hero.aerin" as ActorDefinitionId;

function sourceFor(rules: FixtureRules, name: string): ContentPackSource {
  return { manifest: fixtureManifest(name), ...fresh(definitionsFor(rules)) };
}

/**
 * The whole core pack as authored input, for the schema, semantic and compiler tests that
 * are about the pipeline rather than about a rule.
 */
export function createCoreContentSource(): ContentPackSource {
  return sourceFor("core", "core");
}

/** The character-rules pack as authored input. */
export function createCharacterRulesContentSource(): ContentPackSource {
  return sourceFor("character-rules", "character-rules");
}
