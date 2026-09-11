import type { ContentPackSource } from "../../../../src/content";
import { CORE_ACTIONS } from "./actions";
import { CORE_ACTORS } from "./actors";
import { CORE_ADVENTURES } from "./adventure";
import { CORE_CARDS } from "./cards";
import { CORE_CONDITIONS } from "./conditions";
import { CORE_EQUIPMENT } from "./equipment";
import { CORE_SCENARIOS } from "./scenarios";
import { CORE_TRAITS } from "./traits";

export { CORE_ACTIONS, CORE_ACTORS, CORE_ADVENTURES, CORE_CARDS, CORE_CONDITIONS, CORE_EQUIPMENT, CORE_SCENARIOS, CORE_TRAITS };

/** Every core definition, as the pieces a source pack is built from. */
export const CORE_DEFINITIONS = {
  traits: CORE_TRAITS,
  conditions: CORE_CONDITIONS,
  actions: CORE_ACTIONS,
  cards: CORE_CARDS,
  equipment: CORE_EQUIPMENT,
  actors: CORE_ACTORS,
  scenarios: CORE_SCENARIOS,
  adventures: CORE_ADVENTURES,
} as const satisfies Omit<ContentPackSource, "manifest">;

/** The Encounter ids the tactical fixtures name. */
export const ROAD_AMBUSH_ID = "encounter.road-ambush";
export const RUINED_GATE_ID = "encounter.ruined-gate";
export const GOBLIN_CHIEF_ID = "encounter.goblin-chief";
export const FIXTURE_ADVENTURE_ID = "adventure.goblin-trouble";
