export { chooseAiCommand } from "./ai";
export { createCombat, dispatchCombatCommand } from "./engine";
export { computeCombatSetupFingerprint, fingerprintValue, fnv1a64, stableSerialize } from "./determinism";
export { findPath, findReachableTiles, gridDistance, hasLineOfEffect, hasLineOfSight, positionKey } from "./grid";
export {
  getContextActionOptions,
  listLegalActions,
  listLegalTargets,
  previewAction,
  resolveActionSource,
  validateActionIntent,
} from "./queries";
export { createCombatReplay, hashCombatState, replayCombat } from "./replay";
export { facingToward, getArmorClass, getWeaponProfile, isDirectlyBehind, isInFrontOrSide } from "./rules";
export {
  ATTRIBUTE_IDS,
  SAVE_ATTRIBUTE,
  SAVE_IDS,
  SKILL_ATTRIBUTE,
  SKILL_IDS,
  cloneActorStatProfile,
  formatStatisticSources,
  proficiencyBonus,
  resolveInitiative,
  resolveStatisticDC,
  resolveStatisticModifier,
} from "./statistics";
export type { StatisticResolutionContext } from "./statistics";
export type * from "./types";
