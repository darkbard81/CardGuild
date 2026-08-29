import type { AdventureDefinition, RewardGrant } from "../content/content-types";
import type {
  AdventureCommand,
  AdventureDispatchResult,
  AdventureEvent,
  AdventureState,
  CollectionState,
  PartyState,
  RewardOffer,
} from "./types";

const EMPTY_COLLECTION: CollectionState = { equipment: {}, cards: {} };

function reject(state: AdventureState, error: string): AdventureDispatchResult {
  return { accepted: false, state, events: [], error };
}

function nextEncounterId(definition: AdventureDefinition, state: AdventureState): string | null {
  return definition.encounterIds.find((id) => !state.completedEncounterIds.includes(id)) ?? null;
}

function rewardAfter(definition: AdventureDefinition, encounterId: string): RewardOffer | null {
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

export function createAdventureSession(
  definition: AdventureDefinition,
  party: PartyState,
  adventureSeed: number,
): AdventureState {
  if (!Number.isInteger(adventureSeed)) throw new Error("Adventure seed must be an integer.");
  return {
    version: 1,
    adventureId: definition.id,
    phase: "ready",
    currentEncounterId: null,
    completedEncounterIds: [],
    party: {
      members: Object.fromEntries(
        Object.values(party.members)
          .sort((left, right) => left.id.localeCompare(right.id))
          .map((member) => [member.id, { ...member, equipmentIds: [...member.equipmentIds] }]),
      ),
    },
    collection: EMPTY_COLLECTION,
    pendingReward: null,
    adventureSeed,
  };
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
  definition: AdventureDefinition,
): AdventureDispatchResult {
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
      const completedEncounterIds = [...state.completedEncounterIds, command.result.encounterId];
      const completedState = { ...state, completedEncounterIds };
      const offer = rewardAfter(definition, command.result.encounterId);
      const completedEvent: AdventureEvent = { type: "ENCOUNTER_COMPLETED", encounterId: command.result.encounterId };
      if (offer) {
        return {
          accepted: true,
          state: { ...completedState, phase: "reward", pendingReward: offer },
          events: [completedEvent, { type: "REWARD_OFFERED", offer }],
        };
      }
      const currentEncounterId = nextEncounterId(definition, completedState);
      if (currentEncounterId) {
        return {
          accepted: true,
          state: { ...completedState, phase: "between-encounters", currentEncounterId },
          events: [completedEvent],
        };
      }
      return {
        accepted: true,
        state: { ...completedState, phase: "complete", currentEncounterId: null },
        events: [completedEvent, { type: "ADVENTURE_COMPLETED", adventureId: definition.id }],
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
  }
}
