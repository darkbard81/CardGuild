import type { SessionCoreState, SessionGameplayIntent, SessionSeat } from "./types";

export function seatForPlayer(state: SessionCoreState, playerId: string): SessionSeat | undefined {
  return state.seats.find((seat) => seat.playerId === playerId);
}
export function authorizeSessionIntent(
  state: SessionCoreState,
  playerId: string,
  intent: SessionGameplayIntent,
): string | undefined {
  const seat = seatForPlayer(state, playerId);
  if (!seat) return "Player does not own a seat in this session.";
  const isHost = state.hostPlayerId === playerId;

  switch (intent.type) {
    case "begin-adventure":
      if (!isHost || state.lifecycle !== "lobby") return "Only the host can begin the lobby adventure.";
      return undefined;
    case "start-encounter":
      if (!isHost || state.adventure?.phase !== "between-encounters") {
        return "Only the host can start the pending encounter.";
      }
      return undefined;
    case "choose-reward":
      if (!isHost || state.adventure?.phase !== "reward") return "Only the host can choose a shared reward.";
      return undefined;
    case "set-loadout":
      if (state.adventure?.phase !== "ready" && state.adventure?.phase !== "between-encounters") {
        return "Loadout is not editable in the current phase.";
      }
      return undefined;
    case "use-action":
    case "end-turn":
      if (!state.combat || state.combat.turn.activeActorId !== seat.memberId) {
        return "Player does not control the active actor.";
      }
      return undefined;
    case "use-reaction":
    case "pass-reaction": {
      const pending = state.combat?.pendingReaction;
      if (!pending || pending.triggerId !== intent.triggerId || pending.candidates[0]?.actorId !== seat.memberId) {
        return "Player does not control the head reaction candidate.";
      }
      return undefined;
    }
  }
}
