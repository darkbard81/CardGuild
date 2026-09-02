export {
  actionRangeFeet,
  buildResolvedActionPlan,
  meetsActionRequirements,
  resolveActionDc,
  resolveActionStatistic,
  turnMapContext,
} from "./action-plan";
export type {
  ActionParticipants,
  ResolvedActionCheck,
  ResolvedActionPlan,
  ResolvedActionResolution,
} from "./action-plan";
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
export { equipmentTraits, facingToward, isDirectlyBehind, isInFrontOrSide } from "./rules";
export {
  WEAPON_CATEGORIES,
  equippedWeapon,
  attacksForMap,
  resolveMapPenalty,
  resolveStrike,
  resolveStrikeSource,
  strikeDamageTotal,
  weaponDamageRoll,
} from "./offense";
export type { StrikeResolutionOptions, StrikeSource } from "./offense";
export {
  ARMOR_CATEGORIES,
  ATTRIBUTE_IDS,
  PROFICIENCY_RANKS,
  SAVE_ATTRIBUTE,
  SAVE_IDS,
  SKILL_ATTRIBUTE,
  SKILL_IDS,
  cloneActorStatProfile,
  combineStatisticSources,
  deriveMaxHp,
  effectiveDexterity,
  equippedArmor,
  formatStatisticSources,
  proficiencyBonus,
  proficiencyRankAtLeast,
  resolveArmorClass,
  resolveClassDC,
  resolveInitiative,
  resolveMaxHp,
  resolveModifierStack,
  resolveStatisticDC,
  resolveStatisticModifier,
} from "./statistics";
export type { StatisticResolutionContext } from "./statistics";
export type * from "./types";
