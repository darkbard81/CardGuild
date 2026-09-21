import type { SessionControlContext, SessionCoreState } from "./types";

/** Resume is an explicit safe boundary even when it holds a saved Combat. */
export function isCoopPreparation(state: SessionCoreState): boolean {
  return Boolean(state.adventure) && (state.lifecycle === "resume-lobby"
    || state.lifecycle === "active" && !state.combat && (state.adventure?.phase === "ready" || state.adventure?.phase === "between-encounters"));
}

export function isCoopCompanion(state: SessionCoreState, memberId: string): boolean {
  const member = state.adventure?.party.members[memberId];
  return Boolean(member && member.seat !== 1 && member.identity.origin === "companion");
}

export function guestClaim(state: SessionCoreState, playerId: string): string | undefined {
  return Object.entries(state.guestClaims.byMemberId).find(([, claimant]) => claimant === playerId)?.[0];
}

export function hasValidGuestClaim(state: SessionCoreState, playerId: string): boolean {
  const memberId = guestClaim(state, playerId);
  return !!memberId && state.coopAllowedMemberIds.includes(memberId) && isCoopCompanion(state, memberId);
}

export function waitingGuests(state: SessionCoreState, control: Pick<SessionControlContext, "connectedPlayerIds">) {
  return state.seats.filter(seat => seat.playerId !== state.hostPlayerId
    && control.connectedPlayerIds.includes(seat.playerId) && !hasValidGuestClaim(state, seat.playerId));
}

/** Seats reserve capacity from HTTP admission through attach/claim, including offline claims. */
export function coopAdmissionRemaining(state: SessionCoreState): number {
  return Math.max(0, Math.min(2, state.coopAllowedMemberIds.length) - (state.seats.length - 1));
}

/** Revoke affected claims first, then excess unclaimed admissions in reverse admission order. */
export function coopRemovedPlayers(state: SessionCoreState, allowed: readonly string[]): readonly string[] {
  const guests = state.seats.filter(seat => seat.playerId !== state.hostPlayerId);
  const removed = guests.filter(seat => {
    const claim = guestClaim(state, seat.playerId);
    return claim && !allowed.includes(claim);
  }).map(seat => seat.playerId);
  const kept = guests.filter(seat => !removed.includes(seat.playerId));
  let excess = kept.length - allowed.length;
  for (const seat of [...kept].reverse()) {
    if (excess <= 0) break;
    if (!guestClaim(state, seat.playerId)) { removed.push(seat.playerId); excess--; }
  }
  return removed;
}

export function withoutGuests(state: SessionCoreState, removed: readonly string[]): SessionCoreState {
  return { ...state, seats: state.seats.filter(seat => !removed.includes(seat.playerId)),
    guestClaims: { byMemberId: Object.fromEntries(Object.entries(state.guestClaims.byMemberId).filter(([, playerId]) => !removed.includes(playerId))) } };
}

/** HTTP-only admissions cannot become spectators by attaching after departure. */
export function departureState(state: SessionCoreState, control: SessionControlContext): SessionCoreState {
  return withoutGuests(state, state.seats.filter(seat => seat.playerId !== state.hostPlayerId
    && !control.connectedPlayerIds.includes(seat.playerId) && !hasValidGuestClaim(state, seat.playerId)).map(seat => seat.playerId));
}
