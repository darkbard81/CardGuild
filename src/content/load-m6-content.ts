import actions from "../../content/m6/actions.json";
import actors from "../../content/m6/actors.json";
import adventures from "../../content/m6/adventures.json";
import cards from "../../content/m6/cards.json";
import conditions from "../../content/m6/conditions.json";
import equipment from "../../content/m6/equipment.json";
import manifest from "../../content/m6/manifest.json";
import scenarios from "../../content/m6/scenarios.json";
import traits from "../../content/m6/traits.json";
import { getCombatDefinition, getContentIdentity, compileContentPack } from "./compile-content";
import type { AdventureDefinition, ContentPackSource } from "./content-types";

export const M6_DEFAULT_SEED = 1;
export const M6_ADVENTURE_ID = "adventure.goblin-trouble";
export const M6_ROAD_AMBUSH_ID = "encounter.road-ambush";
export const M6_RUINED_GATE_ID = "encounter.ruined-gate";
export const M6_GOBLIN_CHIEF_ID = "encounter.goblin-chief";

export const M6_CONTENT_SOURCE = {
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

export const M6_COMPILED_PACK = compileContentPack(M6_CONTENT_SOURCE);
export const M6_CONTENT = M6_COMPILED_PACK.combatContent;
export const M6_CONTENT_IDENTITY = getContentIdentity(M6_COMPILED_PACK);

function requireAdventure(id: string): AdventureDefinition {
  const adventure = M6_COMPILED_PACK.adventures[id];
  if (!adventure) throw new Error(`Adventure "${id}" was not compiled.`);
  return adventure;
}

export const M6_ADVENTURE = requireAdventure(M6_ADVENTURE_ID);
export const M6_COMBAT_DEFINITION = getCombatDefinition(M6_COMPILED_PACK, M6_RUINED_GATE_ID);
export const M6_SCENARIO = M6_COMBAT_DEFINITION.scenario;
