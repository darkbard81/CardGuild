import actions from "../../content/m5/actions.json";
import actors from "../../content/m5/actors.json";
import adventures from "../../content/m5/adventures.json";
import cards from "../../content/m5/cards.json";
import conditions from "../../content/m5/conditions.json";
import equipment from "../../content/m5/equipment.json";
import manifest from "../../content/m5/manifest.json";
import scenarios from "../../content/m5/scenarios.json";
import traits from "../../content/m5/traits.json";
import { getCombatDefinition, getContentIdentity, compileContentPack } from "./compile-content";
import type { AdventureDefinition, ContentPackSource } from "./content-types";

export const M5_DEFAULT_SEED = 1;
export const M5_ADVENTURE_ID = "adventure.goblin-trouble";
export const M5_ROAD_AMBUSH_ID = "encounter.road-ambush";
export const M5_RUINED_GATE_ID = "encounter.ruined-gate";
export const M5_GOBLIN_CHIEF_ID = "encounter.goblin-chief";

export const M5_CONTENT_SOURCE = {
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

export const M5_COMPILED_PACK = compileContentPack(M5_CONTENT_SOURCE);
export const M5_CONTENT = M5_COMPILED_PACK.combatContent;
export const M5_CONTENT_IDENTITY = getContentIdentity(M5_COMPILED_PACK);

function requireAdventure(id: string): AdventureDefinition {
  const adventure = M5_COMPILED_PACK.adventures[id];
  if (!adventure) throw new Error(`Adventure "${id}" was not compiled.`);
  return adventure;
}

export const M5_ADVENTURE = requireAdventure(M5_ADVENTURE_ID);
export const M5_COMBAT_DEFINITION = getCombatDefinition(M5_COMPILED_PACK, M5_RUINED_GATE_ID);
export const M5_SCENARIO = M5_COMBAT_DEFINITION.scenario;
