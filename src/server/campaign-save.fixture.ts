/**
 * Test-only builders for durable-save suites. Nothing in the product imports this file: it
 * exists so the save, durability, host and campaign tests all start from one authoritative
 * mid-combat session instead of three hand-written approximations.
 */
import { PRODUCTION_CONTENT } from "../content/production-content";
import {
  createSessionCoreState,
  dispatchSessionIntent,
  type SessionAuthorityContext,
  type SessionControlContext,
  type SessionCoreState,
  type SessionIntent,
} from "../session";

export const FIXTURE_PARTY = ["hero.aerin", "hero.lyra", "hero.brom"] as const;

export const FIXTURE_CONTEXT: SessionAuthorityContext = {
  pack: PRODUCTION_CONTENT.pack,
  adventureId: PRODUCTION_CONTENT.adventureId,
};

export function fixtureControl(state: SessionCoreState): SessionControlContext {
  const connectedPlayerIds = state.seats.map((seat) => seat.playerId);
  const connected = new Set(connectedPlayerIds);
  return {
    connectedPlayerIds,
    effectiveControllerByMemberId: Object.fromEntries(state.partySlots.map((slot) => {
      const guest = state.guestClaims.byMemberId[slot.memberId];
      return [slot.memberId, guest && connected.has(guest) ? guest : state.hostPlayerId];
    })),
  };
}

export function fixtureDispatch(
  state: SessionCoreState,
  playerId: string,
  intent: SessionIntent,
): SessionCoreState {
  const result = dispatchSessionIntent(state, playerId, intent, FIXTURE_CONTEXT, fixtureControl(state));
  if (!result.accepted) throw new Error(`Fixture intent "${intent.type}" was rejected: ${result.error ?? ""}`);
  return result.state;
}

export function fixtureLobby(sessionId = "session-fixture", playerId = "player-fixture"): SessionCoreState {
  return createSessionCoreState({ sessionId, playerId, displayName: "Host", adventureSeed: 1 }, FIXTURE_CONTEXT);
}

/** A one-player session that has begun its adventure: the first durable save point. */
export function fixtureBegun(sessionId = "session-fixture"): SessionCoreState {
  const lobby = fixtureLobby(sessionId);
  const prepared = fixtureDispatch(lobby, lobby.hostPlayerId, {
    type: "set-party-composition",
    actorDefinitionIds: [...FIXTURE_PARTY],
  });
  return fixtureDispatch(prepared, prepared.hostPlayerId, { type: "begin-adventure" });
}

/** A session stopped inside a live encounter, which is what mid-combat recovery must restore. */
export function fixtureMidCombat(sessionId = "session-fixture"): SessionCoreState {
  const begun = fixtureBegun(sessionId);
  return fixtureDispatch(begun, begun.hostPlayerId, { type: "start-encounter" });
}

/** Non-default runtime progression, so a save is not trivially the starting state. */
export function withProgression(
  state: SessionCoreState,
  progression: Readonly<Record<string, { readonly level: number; readonly experience: number }>>,
): SessionCoreState {
  const adventure = state.adventure;
  if (!adventure) throw new Error("Fixture progression requires an AdventureState.");
  return {
    ...state,
    adventure: {
      ...adventure,
      party: {
        members: Object.fromEntries(Object.entries(adventure.party.members).map(([memberId, member]) => [
          memberId,
          { ...member, progression: progression[memberId] ?? member.progression },
        ])),
      },
    },
  };
}
