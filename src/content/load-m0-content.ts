import actions from "../../content/m0/actions.json";
import actors from "../../content/m0/actors.json";
import cards from "../../content/m0/cards.json";
import conditions from "../../content/m0/conditions.json";
import equipment from "../../content/m0/equipment.json";
import manifest from "../../content/m0/manifest.json";
import scenario from "../../content/m0/scenario.json";
import traits from "../../content/m0/traits.json";
import { positionKey } from "../game/grid";
import type { ScenarioDefinition } from "../game/types";
import { compileContentPack, getCombatDefinition, getContentIdentity } from "./compile-content";
import type { ContentPackSource } from "./content-types";

export const M0_DEFAULT_SEED = 1;
export const M0_SCENARIO_ID = "m0-gatehouse";

export const M0_CONTENT_SOURCE = {
  manifest,
  traits,
  conditions,
  actions,
  cards,
  equipment,
  actors,
  scenario,
} as unknown as ContentPackSource;

export const M0_COMPILED_PACK = compileContentPack(M0_CONTENT_SOURCE);
export const M0_CONTENT = M0_COMPILED_PACK.combatContent;
export const M0_CONTENT_IDENTITY = getContentIdentity(M0_COMPILED_PACK);
export const M0_COMBAT_DEFINITION = getCombatDefinition(M0_COMPILED_PACK, M0_SCENARIO_ID);
export const M0_SCENARIO = M0_COMBAT_DEFINITION.scenario;

export function cloneScenario(scenarioDefinition: ScenarioDefinition): ScenarioDefinition {
  return {
    ...scenarioDefinition,
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
  return cloneScenario(M0_SCENARIO);
}
