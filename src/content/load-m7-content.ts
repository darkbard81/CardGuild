import actions from "../../content/m7/actions.json";
import actors from "../../content/m7/actors.json";
import adventures from "../../content/m7/adventures.json";
import cards from "../../content/m7/cards.json";
import conditions from "../../content/m7/conditions.json";
import equipment from "../../content/m7/equipment.json";
import manifest from "../../content/m7/manifest.json";
import scenarios from "../../content/m7/scenarios.json";
import traits from "../../content/m7/traits.json";
import { getCombatDefinition, getContentIdentity, compileContentPack } from "./compile-content";
import type { AdventureDefinition, ContentPackSource } from "./content-types";

export const M7_DEFAULT_SEED = 1;
export const M7_ADVENTURE_ID = "adventure.goblin-trouble";
export const M7_ROAD_AMBUSH_ID = "encounter.road-ambush";
export const M7_RUINED_GATE_ID = "encounter.ruined-gate";
export const M7_GOBLIN_CHIEF_ID = "encounter.goblin-chief";

export const M7_CONTENT_SOURCE = {
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

export const M7_COMPILED_PACK = compileContentPack(M7_CONTENT_SOURCE);
export const M7_CONTENT = M7_COMPILED_PACK.combatContent;
export const M7_CONTENT_IDENTITY = getContentIdentity(M7_COMPILED_PACK);

function requireAdventure(id: string): AdventureDefinition {
  const adventure = M7_COMPILED_PACK.adventures[id];
  if (!adventure) throw new Error(`Adventure "${id}" was not compiled.`);
  return adventure;
}

export const M7_ADVENTURE = requireAdventure(M7_ADVENTURE_ID);
export const M7_COMBAT_DEFINITION = getCombatDefinition(M7_COMPILED_PACK, M7_RUINED_GATE_ID);
export const M7_SCENARIO = M7_COMBAT_DEFINITION.scenario;
