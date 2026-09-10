import type { RewardGrant } from "../content/content-types";
import { clonePartyLoadout, createStartingCollection, validatePartyLoadout } from "../loadout";
import { applyExperience, assertAdventureInvariants, createCharacterProgression } from "./progression";
import type {
  AdventureCommand,
  AdventureDispatchResult,
  AdventureEvent,
  AdventureRuntimeContext,
  AdventureState,
  CollectionState,
  PartyState,
  PartySetup,
  RewardOffer,
} from "./types";

function reject(state: AdventureState, error: string): AdventureDispatchResult {
  return { accepted: false, state, events: [], error };
}

function nextEncounterId(definition: AdventureRuntimeContext["definition"], state: AdventureState): string | null {
  return definition.encounterIds.find((id) => !state.completedEncounterIds.includes(id)) ?? null;
}

function rewardAfter(definition: AdventureRuntimeContext["definition"], encounterId: string): RewardOffer | null {
  const reward = definition.rewards.find((candidate) => candidate.afterEncounterId === encounterId);
  return reward
    ? { rewardId: reward.id, encounterId: reward.afterEncounterId, choices: reward.choices.map((choice) => ({ ...choice })) }
    : null;
}

function grantReward(collection: CollectionState, grant: RewardGrant): CollectionState {
  if (grant.kind === "equipment") {
    return {
      ...collection,
      equipment: { ...collection.equipment, [grant.definitionId]: (collection.equipment[grant.definitionId] ?? 0) + 1 },
    };
  }
  return {
    ...collection,
    cards: { ...collection.cards, [grant.definitionId]: (collection.cards[grant.definitionId] ?? 0) + 1 },
  };
}

export function deriveCombatSeed(adventureSeed: number, encounterId: string): number {
  let value = 0x811c9dc5;
  const input = `${adventureSeed}:${encounterId}`;
  for (let index = 0; index < input.length; index += 1) {
    value ^= input.charCodeAt(index);
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  return value === 0 ? 1 : value;
}

/**
 * The authored EXP for one Encounter. A missing entry is a content bug the validator
 * already refuses, so the runtime treats it as an error rather than as zero.
 */
function experienceFor(definition: AdventureRuntimeContext["definition"], encounterId: string): number {
  const award = definition.experienceAwards.find((candidate) => candidate.afterEncounterId === encounterId);
  if (!award) throw new Error(`Adventure "${definition.id}" has no experience award for "${encounterId}".`);
  return award.amount;
}

/**
 * Award one Encounter's EXP to every current party member and collect the growth events.
 * Everyone in the party is paid the same amount: a member who was down when the battle
 * ended still learned from it, and connection or Guest claim is not a gameplay fact.
 */
function awardExperience(
  party: PartyState,
  encounterId: string,
  amount: number,
): { readonly party: PartyState; readonly events: readonly AdventureEvent[] } {
  if (amount === 0) return { party, events: [] };
  const ordered = Object.values(party.members)
    .sort((left, right) => left.seat - right.seat || left.id.localeCompare(right.id));
  const members: Record<string, PartyState["members"][string]> = { ...party.members };
  const gained: AdventureEvent[] = [];
  const levelled: AdventureEvent[] = [];
  for (const member of ordered) {
    const previous = member.progression;
    const applied = applyExperience(previous, amount);
    members[member.id] = { ...member, progression: applied.progression };
    gained.push({ type: "EXPERIENCE_GAINED", encounterId, memberId: member.id, amount, previous, next: applied.progression });
    for (let step = 1; step <= applied.levelsGained; step += 1) {
      levelled.push({
        type: "LEVEL_UP",
        encounterId,
        memberId: member.id,
        previousLevel: previous.level + step - 1,
        level: previous.level + step,
      });
    }
  }
  return { party: { members }, events: [...gained, ...levelled] };
}

export function createAdventureSession(
  context: AdventureRuntimeContext,
  party: PartySetup,
  adventureSeed: number,
): AdventureState {
  if (!Number.isInteger(adventureSeed)) throw new Error("Adventure seed must be an integer.");
  const roster = Object.values(party.members);
  const { min, max } = context.definition.partySize;
  if (roster.length < min || roster.length > max) {
    throw new Error(`Adventure requires ${min}-${max} party members, received ${roster.length}.`);
  }
  const seats = new Set(roster.map((member) => member.seat));
  if (seats.size !== roster.length) throw new Error("Party member seats must be unique.");
  const clonedParty: PartyState = {
    members: Object.fromEntries(
      roster
        .sort((left, right) => left.seat - right.seat || left.id.localeCompare(right.id))
        .map((member) => {
          const definition = context.actorDefinitions[member.actorDefinitionId];
          if (!definition) throw new Error(`Actor definition "${member.actorDefinitionId}" is missing.`);
          return [member.id, { ...member, loadout: clonePartyLoadout(definition.starterLoadout), progression: createCharacterProgression(definition) }];
        }),
    ),
  };
  const collection = createStartingCollection(clonedParty, context);
  const validation = validatePartyLoadout(clonedParty, collection, context);
  if (!validation.valid) throw new Error(`Invalid starting loadout: ${validation.issues[0]?.message ?? "unknown error"}`);
  const state: AdventureState = {
    version: 3,
    adventureId: context.definition.id,
    phase: "ready",
    currentEncounterId: null,
    completedEncounterIds: [],
    party: clonedParty,
    collection,
    pendingReward: null,
    adventureSeed,
  };
  assertAdventureInvariants(state);
  return state;
}

function startEncounter(state: AdventureState): AdventureDispatchResult {
  if (state.phase !== "between-encounters" || !state.currentEncounterId) {
    return reject(state, "An encounter can only start between encounters.");
  }
  const combatSeed = deriveCombatSeed(state.adventureSeed, state.currentEncounterId);
  return {
    accepted: true,
    state: { ...state, phase: "combat" },
    events: [{ type: "ENCOUNTER_STARTED", encounterId: state.currentEncounterId, combatSeed }],
  };
}

export function dispatchAdventureCommand(
  state: AdventureState,
  command: AdventureCommand,
  context: AdventureRuntimeContext,
): AdventureDispatchResult {
  assertAdventureInvariants(state);
  const definition = context.definition;
  if (state.adventureId !== definition.id) return reject(state, "Adventure definition does not match state.");

  switch (command.type) {
    case "start-adventure": {
      if (state.phase !== "ready") return reject(state, "Adventure has already started.");
      const currentEncounterId = definition.encounterIds[0] ?? null;
      if (!currentEncounterId) return reject(state, "Adventure has no encounters.");
      return {
        accepted: true,
        state: { ...state, phase: "between-encounters", currentEncounterId },
        events: [{ type: "ADVENTURE_STARTED", adventureId: definition.id }],
      };
    }
    case "start-encounter":
    case "continue-adventure":
      return startEncounter(state);
    case "accept-combat-result": {
      if (state.phase !== "combat" || command.result.encounterId !== state.currentEncounterId) {
        return reject(state, "Combat result does not match the active encounter.");
      }
      if (command.result.combatSeed !== deriveCombatSeed(state.adventureSeed, command.result.encounterId)) {
        return reject(state, "Combat result seed does not match the derived encounter seed.");
      }
      if (command.result.outcome === "defeat") {
        return {
          accepted: true,
          state: { ...state, phase: "failed", pendingReward: null },
          events: [{ type: "ADVENTURE_FAILED", encounterId: command.result.encounterId }],
        };
      }
      if (state.completedEncounterIds.includes(command.result.encounterId)) {
        return reject(state, "Encounter has already been completed.");
      }
      const completedEncounterIds = [...state.completedEncounterIds, command.result.encounterId];
      const growth = awardExperience(state.party, command.result.encounterId, experienceFor(definition, command.result.encounterId));
      const completedState = { ...state, completedEncounterIds, party: growth.party };
      const offer = rewardAfter(definition, command.result.encounterId);
      // Fixed publication order: completion, then EXP, then Level-Up, then what comes next.
      const settled: readonly AdventureEvent[] = [
        { type: "ENCOUNTER_COMPLETED", encounterId: command.result.encounterId },
        ...growth.events,
      ];
      if (offer) {
        const rewarded: AdventureState = { ...completedState, phase: "reward", pendingReward: offer };
        assertAdventureInvariants(rewarded);
        return { accepted: true, state: rewarded, events: [...settled, { type: "REWARD_OFFERED", offer }] };
      }
      const currentEncounterId = nextEncounterId(definition, completedState);
      if (currentEncounterId) {
        const between: AdventureState = { ...completedState, phase: "between-encounters", currentEncounterId };
        assertAdventureInvariants(between);
        return { accepted: true, state: between, events: settled };
      }
      const complete: AdventureState = { ...completedState, phase: "complete", currentEncounterId: null };
      assertAdventureInvariants(complete);
      return {
        accepted: true,
        state: complete,
        events: [...settled, { type: "ADVENTURE_COMPLETED", adventureId: definition.id }],
      };
    }
    case "choose-reward": {
      const offer = state.pendingReward;
      if (state.phase !== "reward" || !offer || offer.rewardId !== command.rewardId) {
        return reject(state, "Reward choice does not match the pending offer.");
      }
      const grant = offer.choices[command.choiceIndex];
      if (!grant) return reject(state, "Reward choice index is out of range.");
      const collection = grantReward(state.collection, grant);
      const currentEncounterId = nextEncounterId(definition, state);
      const event: AdventureEvent = { type: "REWARD_GRANTED", rewardId: offer.rewardId, grant };
      if (!currentEncounterId) {
        return {
          accepted: true,
          state: { ...state, phase: "complete", currentEncounterId: null, pendingReward: null, collection },
          events: [event, { type: "ADVENTURE_COMPLETED", adventureId: definition.id }],
        };
      }
      return {
        accepted: true,
        state: { ...state, phase: "between-encounters", currentEncounterId, pendingReward: null, collection },
        events: [event],
      };
    }
    case "set-member-loadout": {
      if (state.phase !== "ready" && state.phase !== "between-encounters") {
        return reject(state, "Loadout can only change while ready or between encounters.");
      }
      const member = state.party.members[command.memberId];
      if (!member) return reject(state, `Party member "${command.memberId}" is missing.`);
      const candidate: PartyState = {
        members: {
          ...state.party.members,
          [member.id]: { ...member, loadout: clonePartyLoadout(command.loadout) },
        },
      };
      const validation = validatePartyLoadout(candidate, state.collection, context);
      if (!validation.valid) return reject(state, validation.issues[0]?.message ?? "Loadout is invalid.");
      const previous = clonePartyLoadout(member.loadout);
      const next = clonePartyLoadout(command.loadout);
      return {
        accepted: true,
        state: { ...state, party: candidate },
        events: [{ type: "LOADOUT_CHANGED", memberId: member.id, previous, next }],
      };
    }
  }
}
