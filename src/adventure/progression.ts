import type { ActorDefinition } from "../content/content-types";
import { cloneActorStatProfile } from "../game/statistics";
import type { ActorStatProfile } from "../game/types";
import type { AdventureState, CharacterProgressionState } from "./types";

export const EXPERIENCE_PER_LEVEL = 1000;

export function assertCharacterProgression(value: unknown): asserts value is CharacterProgressionState {
  if (typeof value !== "object" || value === null) throw new Error("Character progression is required.");
  const { level, experience } = value as Partial<CharacterProgressionState>;
  if (typeof level !== "number" || !Number.isInteger(level) || level < 1) {
    throw new Error("Character progression level must be a positive integer.");
  }
  if (typeof experience !== "number" || !Number.isInteger(experience) || experience < 0 || experience >= EXPERIENCE_PER_LEVEL) {
    throw new Error("Character progression experience must be an integer from 0 to 999.");
  }
}

export function createCharacterProgression(actor: ActorDefinition): CharacterProgressionState {
  if (actor.statProfile.kind !== "character") throw new Error(`Party member "${actor.id}" requires a Character profile.`);
  const progression = { level: actor.statProfile.stats.level, experience: 0 };
  assertCharacterProgression(progression);
  return progression;
}

export function resolveEffectiveCharacterStatProfile(
  actor: ActorDefinition,
  progression: CharacterProgressionState,
): Extract<ActorStatProfile, { kind: "character" }> {
  assertCharacterProgression(progression);
  const profile = cloneActorStatProfile(actor.statProfile);
  if (profile.kind !== "character") throw new Error(`Party member "${actor.id}" requires a Character profile.`);
  return { ...profile, stats: { ...profile.stats, level: progression.level } };
}

/** Validate runtime progression without repairing old or malformed state. */
export function assertAdventureInvariants(state: AdventureState): void {
  if (state.version !== 3) throw new Error("AdventureState must use version 3.");
  for (const member of Object.values(state.party.members)) assertCharacterProgression(member.progression);
}
