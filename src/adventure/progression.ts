import type { ActorDefinition } from "../content/content-types";
import { assertCharacterProgression, resolveCharacterRules } from "../character";
import type { CharacterRulesContext } from "../character";
export { assertCharacterProgression } from "../character";
import type { ActorStatProfile } from "../game/types";
import type { AdventureState, CharacterProgressionState } from "./types";

export const EXPERIENCE_PER_LEVEL = 1000;

export function createCharacterProgression(actor: ActorDefinition): CharacterProgressionState {
  if (actor.statProfile.kind !== "character" || !actor.character) throw new Error(`Party member "${actor.id}" requires a Character profile and Build.`);
  const progression = { level: actor.character.level, experience: 0, advancements: structuredClone(actor.character.advancements) };
  assertCharacterProgression(progression);
  return progression;
}

export function resolveEffectiveCharacterStatProfile(
  actor: ActorDefinition,
  progression: CharacterProgressionState,
  context: CharacterRulesContext,
): Extract<ActorStatProfile, { kind: "character" }> {
  assertCharacterProgression(progression);
  if (actor.statProfile.kind !== "character" || !actor.character) throw new Error(`Party member "${actor.id}" requires a Character profile and Build.`);
  return resolveCharacterRules({ traits: actor.traits, build: actor.character.build, progression }, context).statProfile;
}

/**
 * The one place EXP becomes Level. Pure: the input progression is never mutated, a single
 * award may cross several thresholds at once, and arithmetic that cannot be represented
 * exactly is refused rather than silently rounded.
 */
export function applyExperience(
  progression: CharacterProgressionState,
  amount: number,
): { readonly progression: CharacterProgressionState; readonly levelsGained: number } {
  assertCharacterProgression(progression);
  if (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount < 0) {
    throw new Error("Experience award must be a safe non-negative integer.");
  }
  const total = progression.experience + amount;
  if (!Number.isSafeInteger(total)) throw new Error("Experience total cannot be represented exactly.");
  const levelsGained = Math.floor(total / EXPERIENCE_PER_LEVEL);
  const level = progression.level + levelsGained;
  if (!Number.isSafeInteger(level)) throw new Error("Character level cannot be represented exactly.");
  const next = { ...progression, level, experience: total % EXPERIENCE_PER_LEVEL };
  assertCharacterProgression(next);
  return { progression: next, levelsGained };
}

/** Validate runtime progression without repairing old or malformed state. */
export function assertAdventureInvariants(state: AdventureState): void {
  if (state.version !== 4) throw new Error("AdventureState must use version 4.");
  for (const member of Object.values(state.party.members)) assertCharacterProgression(member.progression);
}
