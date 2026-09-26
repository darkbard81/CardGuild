import { isCoopPreparation, waitingGuests } from "./coop";
import type {
  SessionControlContext,
  SessionCoreState,
  SessionIntent,
  SessionPartySlot,
  SessionSeat,
} from "./types";

export function seatForPlayer(state: SessionCoreState, playerId: string): SessionSeat | undefined {
  return state.seats.find((seat) => seat.playerId === playerId);
}

export function partySlotForMember(state: SessionCoreState, memberId: string): SessionPartySlot | undefined {
  return state.partySlots.find((slot) => slot.memberId === memberId);
}

export function claimedMemberForPlayer(state: SessionCoreState, playerId: string): string | undefined {
  return Object.entries(state.guestClaims.byMemberId)
    .find(([, claimantPlayerId]) => claimantPlayerId === playerId)?.[0];
}

export function controlledMemberIds(
  state: SessionCoreState,
  playerId: string,
  control: SessionControlContext,
): ReadonlySet<string> {
  return new Set(
    state.partySlots
      .filter((slot) => control.effectiveControllerByMemberId[slot.memberId] === playerId)
      .map((slot) => slot.memberId),
  );
}

function controlledBy(
  memberId: string | undefined,
  playerId: string,
  control: SessionControlContext,
): boolean {
  return Boolean(memberId && control.effectiveControllerByMemberId[memberId] === playerId);
}

/**
 * Intents that a restored Campaign accepts before its Host presses Resume. Everything else
 * is forbidden in `resume-lobby`, because a restored session already holds saved Adventure
 * and Combat state that a stale or hostile client could otherwise drive.
 */
const RESUME_LOBBY_INTENTS = new Set<SessionIntent["type"]>([
  "select-character",
  "release-character",
  "remove-offline-guest",
  "resume-adventure",
  "set-coop-allowed",
  "proceed-solo",
  "leave-preparation",
]);

export function authorizeSessionIntent(
  state: SessionCoreState,
  playerId: string,
  intent: SessionIntent,
  control: SessionControlContext,
): string | undefined {
  const seat = seatForPlayer(state, playerId);
  if (!seat) return "Player does not own a seat in this session.";
  const isHost = state.hostPlayerId === playerId;
  if (state.lifecycle === "resume-lobby" && !RESUME_LOBBY_INTENTS.has(intent.type)) {
    return "A restored campaign accepts no gameplay before the host resumes it.";
  }

  if (state.lifecycle === "active" && state.combat?.opening?.phase === "dialogue" && intent.type !== "complete-scene") return "Complete the scene before gameplay resumes.";
  switch (intent.type) {
    case "complete-scene":
      return isHost && state.lifecycle === "active" && state.combat?.opening?.phase === "dialogue"
        && intent.sceneId === state.combat.rules?.opening?.sceneId ? undefined : "Only the host can complete the pending scene.";
    case "set-coop-allowed":
    case "proceed-solo":
      if (!isHost || !isCoopPreparation(state)) return "Only the host can change Co-op at a preparation boundary.";
      return undefined;
    case "leave-preparation":
      if (isHost || !isCoopPreparation(state)) return "Only a guest can leave preparation.";
      return undefined;
    case "create-character":
      if (!isHost || state.lifecycle !== "lobby" || state.adventure) return "Only the host of an uncreated Campaign can create its protagonist.";
      if (state.seats.length !== 1) return "Character creation requires a solo host.";
      return undefined;
    case "set-party-composition":
      if (!isHost || state.lifecycle !== "lobby") return "Only the host can prepare the lobby party.";
      if (Object.keys(state.guestClaims.byMemberId).length > 0) {
        return "Party composition is locked after a guest claims a character.";
      }
      return undefined;
    case "release-character":
    case "select-character":
      if (isHost || !isCoopPreparation(state)) return "Only a guest can select a companion during preparation.";
      if (!state.partyPrepared) return "The host must prepare the party before guests select characters.";
      return undefined;
    case "remove-offline-guest": {
      if (!isHost || !isCoopPreparation(state)) return "Only the lobby host can remove an abandoned guest seat.";
      const guestSeat = seatForPlayer(state, intent.playerId);
      if (!guestSeat || intent.playerId === state.hostPlayerId) return "Only a current guest seat can be removed.";
      if (control.connectedPlayerIds.includes(intent.playerId)) return "A connected guest cannot be removed.";
      if (claimedMemberForPlayer(state, intent.playerId)) return "A guest with a character claim cannot be removed.";
      return undefined;
    }
    case "begin-adventure": {
      if (!isHost || state.lifecycle !== "lobby") return "Only the host can begin the lobby adventure.";
      if (!state.partyPrepared) return "The host must prepare a party before beginning the adventure.";
      if (state.partySlots.length < state.seats.length) return "The prepared party is smaller than the player roster.";
      const waiting = waitingGuests(state, control);
      if (waiting.length) return `${waiting.map(seat => seat.displayName).join(", ")} must select a companion.`;
      return undefined;
    }
    case "resume-adventure":
      if (!isHost || state.lifecycle !== "resume-lobby") return "Only the host can resume a restored campaign.";
      if (waitingGuests(state, control).length) return `${waitingGuests(state, control).map(seat => seat.displayName).join(", ")} must select a companion.`;
      return undefined;
    case "start-encounter":
      if (!isHost || state.lifecycle !== "active" || !["ready", "between-encounters"].includes(state.adventure?.phase ?? "")) {
        return "Only the host can start the pending encounter.";
      }
      if (waitingGuests(state, control).length) return `${waitingGuests(state, control).map(seat => seat.displayName).join(", ")} must select a companion.`;
      return undefined;
    case "choose-reward":
      if (!isHost || state.lifecycle !== "active" || state.adventure?.phase !== "reward") {
        return "Only the host can choose a shared reward.";
      }
      return undefined;
    case "advance-character":
    case "set-loadout":
      if (state.lifecycle !== "active") return "Loadout is not editable outside an active adventure.";
      if (state.combat || !["ready", "between-encounters"].includes(state.adventure?.phase ?? "")) {
        return "Loadout is not editable in the current phase.";
      }
      if (!state.adventure?.party.members[intent.memberId]) return "Party member does not exist in this adventure.";
      if (!controlledBy(intent.memberId, playerId, control)) return "Player does not control this party member.";
      return undefined;
    case "use-action":
    case "end-turn": {
      if (state.lifecycle !== "active") return "Combat input requires an active adventure.";
      const activeActorId = state.combat?.turn.activeActorId;
      if (!controlledBy(activeActorId, playerId, control)) return "Player does not control the active actor.";
      return undefined;
    }
    case "use-reaction":
    case "pass-reaction": {
      if (state.lifecycle !== "active") return "Combat input requires an active adventure.";
      const pending = state.combat?.pendingReaction;
      const actorId = pending?.candidates[0]?.actorId;
      if (!pending || pending.triggerId !== intent.triggerId || !controlledBy(actorId, playerId, control)) {
        return "Player does not control the head reaction candidate.";
      }
      return undefined;
    }
  }
}
