import { assertMemberIdentity, isAuthoredPlayable, resolvePartyMemberDefinition } from "../character/member";
import type { ActorDefinition, CompiledContentPack } from "../content/content-types";
import { assertCharacterProgression, pendingCharacterAdvancements, resolveCharacterRules } from "../character";
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
  if (state.version !== 6) throw new Error("AdventureState must use version 6.");
  const members = Object.values(state.party.members);
  if (members.length < 1 || members.length > 3) throw new Error("Party must contain 1–3 members.");
  const players = members.filter(member => member.identity?.origin === "player-created");
  if (state.partyOrigin === "player-created" ? players.length !== 1 || players[0]?.seat !== 1 : state.partyOrigin !== "authored" || players.length !== 0) {
    throw new Error("Player-created Campaign requires exactly one protagonist in slot 1.");
  }
  const npcs = new Set<string>();
  const seats = new Set<number>();
  for (const [id, member] of Object.entries(state.party.members)) {
    if (member.id !== id || ![1, 2, 3].includes(member.seat) || seats.has(member.seat)) throw new Error("Invalid member identity/seat.");
    seats.add(member.seat);
    assertMemberIdentity(member.identity);
    assertCharacterProgression(member.progression);
    if (member.identity.origin === "companion") {
      if (npcs.has(member.actorDefinitionId)) throw new Error("Companion NPC may only be recruited once.");
      npcs.add(member.actorDefinitionId);
    }
  }
}

/** Content-aware ingress validation shared by live SessionHost and durable save restore. */
export function assertAdventureCharacterInvariants(
  state: AdventureState,
  context: Pick<CompiledContentPack, "actorDefinitions" | "characterRules" | "creationPresets" | "companions" | "adventures">,
): void {
  assertAdventureInvariants(state);
  const definition = context.adventures[state.adventureId];
  if (!definition) throw new Error("Unknown adventure.");
  if (definition.rewards.some(reward => reward.choices.some(choice => choice.kind === "companion"))
    && state.partyOrigin !== "player-created") throw new Error("Recruitment adventures require a created protagonist.");
  const pending = state.pendingReward;
  if ((state.phase === "reward") !== Boolean(pending)) throw new Error("Reward phase and pending offer must agree.");
  if (pending) {
    const reward = definition.rewards.find(reward => reward.id === pending.rewardId);
    if (!reward || reward.afterEncounterId !== pending.encounterId || state.currentEncounterId !== pending.encounterId
      || !state.completedEncounterIds.includes(pending.encounterId)
      || JSON.stringify(reward.choices) !== JSON.stringify(pending.choices)) throw new Error("Invalid pending reward provenance.");
  }
  for (const member of Object.values(state.party.members)) {
    const actor = resolvePartyMemberDefinition(member, context);
    if (member.identity.origin === "companion") {
      if (!isAuthoredPlayable(actor, context)) throw new Error("Creation templates cannot become authored companion NPCs.");
      if (member.identity.recruitmentSource === "authored-starter") {
        if (state.partyOrigin !== "authored") throw new Error("Created campaigns cannot inject authored starter companions.");
      } else {
        const source = member.identity.recruitmentSource;
        const reward = definition.rewards.find(reward => reward.id === source);
        const choice = reward?.choices.find(choice => choice.kind === "companion"
          && context.companions?.[choice.definitionId]?.actorDefinitionId === member.actorDefinitionId);
        if (!reward || !choice || !state.completedEncounterIds.includes(reward.afterEncounterId)
          || pending?.rewardId === reward.id) {
          throw new Error("Companion recruitment source is not a settled authored reward.");
        }
      }
    }
    if (!actor.character || !actor.traits.some(t => t.id === "playable")) throw new Error("Party member must be a playable Character.");
    resolveEffectiveCharacterStatProfile(actor, member.progression, context.characterRules);
    if (state.phase === "combat"
      && pendingCharacterAdvancements(member.progression.level, member.progression.advancements).length) {
      throw new Error("An active encounter cannot contain pending Character advancements.");
    }
  }
  for (const reward of definition.rewards) {
    if (!state.completedEncounterIds.includes(reward.afterEncounterId) || pending?.rewardId === reward.id) continue;
    const choice = reward.choices.length === 1 ? reward.choices[0] : undefined;
    if (choice?.kind === "companion" && !Object.values(state.party.members).some(member => member.identity.origin === "companion"
      && member.identity.recruitmentSource === reward.id && member.actorDefinitionId === context.companions?.[choice.definitionId]?.actorDefinitionId)) {
      throw new Error("Settled mandatory recruitment is missing its companion.");
    }
  }
}
