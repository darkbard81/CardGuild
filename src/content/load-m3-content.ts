import actions from "../../content/m3/actions.json";
import actors from "../../content/m3/actors.json";
import adventures from "../../content/m3/adventures.json";
import cards from "../../content/m3/cards.json";
import conditions from "../../content/m3/conditions.json";
import equipment from "../../content/m3/equipment.json";
import manifest from "../../content/m3/manifest.json";
import scenarios from "../../content/m3/scenarios.json";
import traits from "../../content/m3/traits.json";
import { positionKey } from "../game/grid";
import { cloneActorStatProfile } from "../game/statistics";
import type { ScenarioDefinition } from "../game/types";
import { compileContentPack, getCombatDefinition, getContentIdentity } from "./compile-content";
import type { AdventureDefinition, ContentPackSource } from "./content-types";

export const M3_DEFAULT_SEED = 1;
export const M3_ADVENTURE_ID = "adventure.goblin-trouble";
export const M3_ROAD_AMBUSH_ID = "encounter.road-ambush";
export const M3_RUINED_GATE_ID = "encounter.ruined-gate";
export const M3_GOBLIN_CHIEF_ID = "encounter.goblin-chief";

export const M3_CONTENT_SOURCE = {
  manifest,
  traits,
  conditions,
  actions,
  cards,
  equipment,
  actors,
  scenarios,
  adventures,
} as unknown as ContentPackSource;

export const M3_COMPILED_PACK = compileContentPack(M3_CONTENT_SOURCE);
export const M3_CONTENT = M3_COMPILED_PACK.combatContent;
export const M3_CONTENT_IDENTITY = getContentIdentity(M3_COMPILED_PACK);
function requireAdventure(id: string): AdventureDefinition {
  const adventure = M3_COMPILED_PACK.adventures[id];
  if (!adventure) throw new Error(`Adventure "${id}" was not compiled.`);
  return adventure;
}
export const M3_ADVENTURE = requireAdventure(M3_ADVENTURE_ID);
export const M3_COMBAT_DEFINITION = getCombatDefinition(M3_COMPILED_PACK, M3_RUINED_GATE_ID);
export const M3_SCENARIO = M3_COMBAT_DEFINITION.scenario;

// M4 is the authoritative content contract. Legacy M3 names remain as
// source-compatible fixture aliases for the already-shipped M0-M3 test surface.
export const M4_DEFAULT_SEED = M3_DEFAULT_SEED;
export const M4_ADVENTURE_ID = M3_ADVENTURE_ID;
export const M4_ROAD_AMBUSH_ID = M3_ROAD_AMBUSH_ID;
export const M4_RUINED_GATE_ID = M3_RUINED_GATE_ID;
export const M4_GOBLIN_CHIEF_ID = M3_GOBLIN_CHIEF_ID;
export const M4_CONTENT_SOURCE = M3_CONTENT_SOURCE;
export const M4_COMPILED_PACK = M3_COMPILED_PACK;
export const M4_CONTENT = M3_CONTENT;
export const M4_CONTENT_IDENTITY = M3_CONTENT_IDENTITY;
export const M4_ADVENTURE = M3_ADVENTURE;
export const M4_COMBAT_DEFINITION = M3_COMBAT_DEFINITION;
export const M4_SCENARIO = M3_SCENARIO;

export function cloneScenario(scenarioDefinition: ScenarioDefinition): ScenarioDefinition {
  return {
    ...scenarioDefinition,
    objective: { ...scenarioDefinition.objective },
    actors: scenarioDefinition.actors.map((actor) => ({
      ...actor,
      statProfile: cloneActorStatProfile(actor.statProfile),
      position: { ...actor.position },
      fallbackWeapon: { ...actor.fallbackWeapon, damage: { ...actor.fallbackWeapon.damage } },
      conditions: actor.conditions.map((condition) => ({ ...condition })),
      traits: actor.traits.map((trait) => ({ ...trait, params: trait.params ? { ...trait.params } : undefined })),
      equipmentIds: [...actor.equipmentIds],
      innateActionIds: [...actor.innateActionIds],
      deckContributions: actor.deckContributions.map((contribution) => ({
        ...contribution,
        source: { ...contribution.source },
      })),
    })),
    map: {
      ...scenarioDefinition.map,
      tiles: Object.fromEntries(
        Object.values(scenarioDefinition.map.tiles).map((tile) => [
          positionKey(tile.position),
          {
            ...tile,
            position: { ...tile.position },
            traits: tile.traits.map((trait) => ({ ...trait, params: trait.params ? { ...trait.params } : undefined })),
          },
        ]),
      ),
      objects: Object.fromEntries(
        Object.values(scenarioDefinition.map.objects).map((object) => [
          object.id,
          {
            ...object,
            position: { ...object.position },
            traits: object.traits.map((trait) => ({ ...trait, params: trait.params ? { ...trait.params } : undefined })),
            interaction: { ...object.interaction },
          },
        ]),
      ),
    },
  };
}

export function cloneM0Scenario(): ScenarioDefinition {
  return cloneScenario(M3_SCENARIO);
}

// These names remain as test-fixture aliases for the original vertical slice.
// They point at the authoritative v4 Ruined Gate content, not a compatibility pack.
export const M0_DEFAULT_SEED = M3_DEFAULT_SEED;
export const M0_SCENARIO_ID = M3_RUINED_GATE_ID;
export const M0_CONTENT_SOURCE = M3_CONTENT_SOURCE;
export const M0_COMPILED_PACK = M3_COMPILED_PACK;
export const M0_CONTENT = M3_CONTENT;
export const M0_CONTENT_IDENTITY = M3_CONTENT_IDENTITY;
export const M0_COMBAT_DEFINITION = M3_COMBAT_DEFINITION;
export const M0_SCENARIO = M3_SCENARIO;
