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
  "remove-offline-guest",
  "resume-adventure",
]);

/** A pre-Resume lobby is the one place where seats change without gameplay being live. */
function isLobbyLifecycle(state: SessionCoreState): boolean {
  return state.lifecycle === "lobby" || state.lifecycle === "resume-lobby";
}

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

  switch (intent.type) {
    case "set-party-composition":
      if (!isHost || state.lifecycle !== "lobby") return "Only the host can prepare the lobby party.";
      if (Object.keys(state.guestClaims.byMemberId).length > 0) {
        return "Party composition is locked after a guest claims a character.";
      }
      return undefined;
    case "select-character":
      if (isHost || !isLobbyLifecycle(state)) return "Only a guest can select a lobby character.";
      if (!state.partyPrepared) return "The host must prepare the party before guests select characters.";
      return undefined;
    case "remove-offline-guest": {
      if (!isHost || !isLobbyLifecycle(state)) return "Only the lobby host can remove an abandoned guest seat.";
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
      const unclaimedGuest = state.seats
        .filter((candidate) => candidate.playerId !== state.hostPlayerId)
        .find((candidate) => !claimedMemberForPlayer(state, candidate.playerId));
      if (unclaimedGuest) return unclaimedGuest.displayName + " must select a character before the adventure begins.";
      return undefined;
    }
    case "resume-adventure":
      // A host may resume alone, and a guest who joined without claiming anyone does not
      // block it: unclaimed characters simply fall back to the host.
      if (!isHost || state.lifecycle !== "resume-lobby") return "Only the host can resume a restored campaign.";
      return undefined;
    case "start-encounter":
      if (!isHost || state.lifecycle !== "active" || state.adventure?.phase !== "between-encounters") {
        return "Only the host can start the pending encounter.";
      }
      return undefined;
    case "choose-reward":
      if (!isHost || state.lifecycle !== "active" || state.adventure?.phase !== "reward") {
        return "Only the host can choose a shared reward.";
      }
      return undefined;
    case "set-loadout":
      if (state.lifecycle !== "active") return "Loadout is not editable outside an active adventure.";
      if (state.adventure?.phase !== "ready" && state.adventure?.phase !== "between-encounters") {
        return "Loadout is not editable in the current phase.";
      }
      if (!state.adventure.party.members[intent.memberId]) return "Party member does not exist in this adventure.";
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
