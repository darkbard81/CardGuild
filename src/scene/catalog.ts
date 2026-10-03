import dialogue from "./campaign-dialogue.json";
import type { CampaignDialogue } from "../authoring/types";
import type { SceneDefinition } from "./types";

export { SCENE_CATALOG } from "./face-catalog";
export const CAMPAIGN_DIALOGUE: CampaignDialogue = dialogue;
function boundScene(id: string): SceneDefinition {
  const scene = CAMPAIGN_DIALOGUE.scenes[id];
  if (!scene) throw new Error(`Unknown campaign scene: ${id}`);
  return scene;
}
export const WELCOME_SCENE = boundScene(dialogue.bindings.welcome);
export const FIRST_BATTLE_SCENE = boundScene(dialogue.bindings.firstBattle);
export const PRONE_RECOVERY_SCENE = boundScene(dialogue.bindings.proneRecovery);
export const FLANKING_TRAINING_SCENE = boundScene(dialogue.bindings.flankingTraining);
export const KNOWLEDGE_TRAINING_SCENE = boundScene(dialogue.bindings.knowledgeTraining);
export const ENCOUNTER_BRIEFINGS: Readonly<Record<string, SceneDefinition>> = Object.fromEntries(
  Object.entries(dialogue.bindings.encounters).map(([id, binding]) => [id, boundScene(binding.sceneId)]),
);
// Existing chapter callers retain the same scene identities while authoring is data-driven.
export const CHAPTER_ONE_BRIEFINGS = ENCOUNTER_BRIEFINGS;
