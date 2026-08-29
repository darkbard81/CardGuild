import actions from "../../content/m2/actions.json";
import actors from "../../content/m2/actors.json";
import adventures from "../../content/m2/adventures.json";
import cards from "../../content/m2/cards.json";
import conditions from "../../content/m2/conditions.json";
import equipment from "../../content/m2/equipment.json";
import manifest from "../../content/m2/manifest.json";
import scenarios from "../../content/m2/scenarios.json";
import traits from "../../content/m2/traits.json";
import { positionKey } from "../game/grid";
import type { ScenarioDefinition } from "../game/types";
import { compileContentPack, getCombatDefinition, getContentIdentity } from "./compile-content";
import type { AdventureDefinition, ContentPackSource } from "./content-types";

export const M2_DEFAULT_SEED = 1;
export const M2_ADVENTURE_ID = "adventure.goblin-trouble";
export const M2_ROAD_AMBUSH_ID = "encounter.road-ambush";
export const M2_RUINED_GATE_ID = "encounter.ruined-gate";
export const M2_GOBLIN_CHIEF_ID = "encounter.goblin-chief";

export const M2_CONTENT_SOURCE = {
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

export const M2_COMPILED_PACK = compileContentPack(M2_CONTENT_SOURCE);
export const M2_CONTENT = M2_COMPILED_PACK.combatContent;
export const M2_CONTENT_IDENTITY = getContentIdentity(M2_COMPILED_PACK);
function requireAdventure(id: string): AdventureDefinition {
  const adventure = M2_COMPILED_PACK.adventures[id];
  if (!adventure) throw new Error(`Adventure "${id}" was not compiled.`);
  return adventure;
}
export const M2_ADVENTURE = requireAdventure(M2_ADVENTURE_ID);
export const M2_COMBAT_DEFINITION = getCombatDefinition(M2_COMPILED_PACK, M2_RUINED_GATE_ID);
export const M2_SCENARIO = M2_COMBAT_DEFINITION.scenario;

export function cloneScenario(scenarioDefinition: ScenarioDefinition): ScenarioDefinition {
  return {
    ...scenarioDefinition,
    objective: { ...scenarioDefinition.objective },
    actors: scenarioDefinition.actors.map((actor) => ({
      ...actor,
      position: { ...actor.position },
      fallbackWeapon: { ...actor.fallbackWeapon, damage: { ...actor.fallbackWeapon.damage } },
      conditions: actor.conditions.map((condition) => ({ ...condition })),
      traits: actor.traits.map((trait) => ({ ...trait, params: trait.params ? { ...trait.params } : undefined })),
      equipmentIds: [...actor.equipmentIds],
      innateActionIds: [...actor.innateActionIds],
      baseCardGrants: actor.baseCardGrants.map((grant) => ({ ...grant })),
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
  return cloneScenario(M2_SCENARIO);
}

// These names remain as test-fixture aliases for the original vertical slice.
// They point at the authoritative v2 Ruined Gate content, not a v1 compatibility pack.
export const M0_DEFAULT_SEED = M2_DEFAULT_SEED;
export const M0_SCENARIO_ID = M2_RUINED_GATE_ID;
export const M0_CONTENT_SOURCE = M2_CONTENT_SOURCE;
export const M0_COMPILED_PACK = M2_COMPILED_PACK;
export const M0_CONTENT = M2_CONTENT;
export const M0_CONTENT_IDENTITY = M2_CONTENT_IDENTITY;
export const M0_COMBAT_DEFINITION = M2_COMBAT_DEFINITION;
export const M0_SCENARIO = M2_SCENARIO;
