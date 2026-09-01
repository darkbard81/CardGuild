import { describe, expect, it } from "vitest";

import { M5_ADVENTURE_ID, M5_COMPILED_PACK } from "../content";
import { hashCombatState } from "../game";
import {
  createSessionCoreState,
  dispatchSessionIntent,
  hashSessionGameplayState,
  joinSessionCore,
} from ".";
import type {
  SessionAuthorityContext,
  SessionControlContext,
  SessionCoreState,
  SessionIntent,
  SessionPlayerIdentity,
  SessionTransitionResult,
} from "./types";

const context: SessionAuthorityContext = {
  pack: M5_COMPILED_PACK,
  adventureId: M5_ADVENTURE_ID,
};
const DEFAULT_PARTY = ["hero.aerin", "hero.lyra", "hero.brom"] as const;

function player(playerId: string, displayName = playerId): SessionPlayerIdentity {
  return { playerId, displayName };
}

function lobby(sessionId = "session-a", host = player("player-a", "Host")): SessionCoreState {
  return createSessionCoreState({ ...host, sessionId, adventureSeed: 90210 }, context);
}

function control(
  state: SessionCoreState,
  connectedPlayerIds: readonly string[] = state.seats.map((seat) => seat.playerId),
): SessionControlContext {
  const connected = new Set(connectedPlayerIds);
  return {
    connectedPlayerIds,
    effectiveControllerByMemberId: Object.fromEntries(state.partySlots.map((slot) => {
      const guest = state.guestClaims.byMemberId[slot.memberId];
      return [slot.memberId, guest && connected.has(guest) ? guest : state.hostPlayerId];
    })),
  };
}

function dispatch(
  state: SessionCoreState,
  playerId: string,
  intent: SessionIntent,
  connectedPlayerIds?: readonly string[],
): SessionTransitionResult {
  return dispatchSessionIntent(state, playerId, intent, context, control(state, connectedPlayerIds));
}

function prepare(state: SessionCoreState, ids: readonly string[] = DEFAULT_PARTY): SessionCoreState {
  const result = dispatch(state, state.hostPlayerId, { type: "set-party-composition", actorDefinitionIds: ids });
  expect(result.accepted).toBe(true);
  return result.state;
}

function join(state: SessionCoreState, identity: SessionPlayerIdentity): SessionCoreState {
  const result = joinSessionCore(state, identity, context);
  expect(result.accepted).toBe(true);
  return result.state;
}

function claim(state: SessionCoreState, playerId: string, memberId: string): SessionCoreState {
  const result = dispatch(state, playerId, { type: "select-character", memberId });
  expect(result.accepted).toBe(true);
  return result.state;
}

function readyThreePlayers(prefix = "player", sessionId = "session-a"): SessionCoreState {
  let state = lobby(sessionId, player(prefix + "-a", "Host"));
  state = join(state, player(prefix + "-b", "Guest B"));
  state = join(state, player(prefix + "-c", "Guest C"));
  state = prepare(state);
  state = claim(state, prefix + "-b", "party.hero-2");
  return claim(state, prefix + "-c", "party.hero-3");
}

function beginAndStart(state: SessionCoreState): SessionCoreState {
  const begun = dispatch(state, state.hostPlayerId, { type: "begin-adventure" });
  expect(begun.accepted).toBe(true);
  const started = dispatch(begun.state, begun.state.hostPlayerId, { type: "start-encounter" });
  expect(started.accepted).toBe(true);
  return started.state;
}

describe("pure M5 Session authority", () => {
  it("keeps player seats separate and prepares deterministic 1/2/3-character parties", () => {
    for (const size of [1, 2, 3] as const) {
      const state = prepare(lobby("session-" + String(size)), DEFAULT_PARTY.slice(0, size));
      expect(state.version).toBe(2);
      expect(state.seats).toEqual([{ seat: 1, playerId: "player-a", displayName: "Host" }]);
      expect(state.partySlots).toEqual(DEFAULT_PARTY.slice(0, size).map((actorDefinitionId, index) => ({
        slot: index + 1,
        memberId: "party.hero-" + String(index + 1),
        actorDefinitionId,
      })));
      expect(state.guestClaims).toEqual({ byMemberId: {} });
    }
  });

  it("rejects duplicate, unknown, non-playable, undersized, and post-claim party edits", () => {
    let state = join(lobby(), player("player-b", "Guest"));
    for (const actorDefinitionIds of [
      ["hero.aerin"],
      ["hero.aerin", "hero.aerin"],
      ["hero.aerin", "missing.hero"],
      ["hero.aerin", "enemy.goblin-skirmisher"],
    ]) {
      const result = dispatch(state, state.hostPlayerId, { type: "set-party-composition", actorDefinitionIds });
      expect(result.accepted).toBe(false);
      expect(result.state).toBe(state);
    }

    state = prepare(state);
    const unchanged = dispatch(state, state.hostPlayerId, {
      type: "set-party-composition",
      actorDefinitionIds: DEFAULT_PARTY,
    });
    expect(unchanged.accepted).toBe(false);
    expect(unchanged.errorCode).toBe("DOMAIN_REJECTED");
    expect(unchanged.state).toBe(state);
    state = claim(state, "player-b", "party.hero-2");
    const locked = dispatch(state, state.hostPlayerId, {
      type: "set-party-composition",
      actorDefinitionIds: ["hero.brom", "hero.lyra", "hero.aerin"],
    });
    expect(locked.accepted).toBe(false);
    expect(locked.errorCode).toBe("FORBIDDEN");
  });

  it("enforces guest claim exclusivity, atomic switching, and the begin gate", () => {
    let state = lobby();
    state = join(state, player("player-b", "Guest B"));
    state = join(state, player("player-c", "Guest C"));
    state = prepare(state);

    expect(dispatch(state, "player-b", { type: "select-character", memberId: "party.hero-1" }).accepted).toBe(false);
    expect(dispatch(state, state.hostPlayerId, { type: "select-character", memberId: "party.hero-2" }).accepted).toBe(false);
    const beforeClaims = dispatch(state, state.hostPlayerId, { type: "begin-adventure" });
    expect(beforeClaims.accepted).toBe(false);

    state = claim(state, "player-b", "party.hero-2");
    const sameClaim = dispatch(state, "player-b", {
      type: "select-character",
      memberId: "party.hero-2",
    });
    expect(sameClaim.accepted).toBe(false);
    expect(sameClaim.errorCode).toBe("DOMAIN_REJECTED");
    expect(sameClaim.state).toBe(state);
    state = claim(state, "player-b", "party.hero-3");
    expect(state.guestClaims.byMemberId).toEqual({ "party.hero-3": "player-b" });
    state = claim(state, "player-c", "party.hero-2");
    const taken = dispatch(state, "player-b", { type: "select-character", memberId: "party.hero-2" });
    expect(taken.accepted).toBe(false);
    expect(taken.errorCode).toBe("CHARACTER_TAKEN");

    const begun = dispatch(state, state.hostPlayerId, { type: "begin-adventure" });
    expect(begun.accepted).toBe(true);
    expect(Object.keys(begun.state.adventure?.party.members ?? {})).toEqual([
      "party.hero-1",
      "party.hero-2",
      "party.hero-3",
    ]);
  });

  it("limits joins to a prepared party and locks late join after begin", () => {
    let state = prepare(lobby(), ["hero.aerin", "hero.lyra"]);
    state = join(state, player("player-b"));
    const full = joinSessionCore(state, player("player-c"), context);
    expect(full.accepted).toBe(false);
    expect(full.errorCode).toBe("SESSION_FULL");
    state = claim(state, "player-b", "party.hero-2");
    const begun = dispatch(state, state.hostPlayerId, { type: "begin-adventure" });
    expect(begun.accepted).toBe(true);
    const late = joinSessionCore(begun.state, player("player-c"), context);
    expect(late.accepted).toBe(false);
    expect(late.errorCode).toBe("ROSTER_LOCKED");
  });

  it("lets the host remove only an offline unclaimed lobby guest without changing gameplay hash", () => {
    const hostPlayerId = "player-a";
    const guestPlayerId = "player-b";
    let state = join(lobby(), player(guestPlayerId, "Guest B"));
    state = prepare(state);
    const removeIntent: SessionIntent = { type: "remove-offline-guest", playerId: guestPlayerId };

    const connected = dispatch(state, hostPlayerId, removeIntent, [hostPlayerId, guestPlayerId]);
    expect(connected.accepted).toBe(false);
    expect(connected.state).toBe(state);
    const byGuest = dispatch(state, guestPlayerId, removeIntent, [hostPlayerId]);
    expect(byGuest.accepted).toBe(false);
    expect(byGuest.state).toBe(state);

    const claimed = claim(state, guestPlayerId, "party.hero-2");
    const claimedOffline = dispatch(claimed, hostPlayerId, removeIntent, [hostPlayerId]);
    expect(claimedOffline.accepted).toBe(false);
    expect(claimedOffline.state).toBe(claimed);

    const beforeHash = hashSessionGameplayState(state);
    const removed = dispatch(state, hostPlayerId, removeIntent, [hostPlayerId]);
    expect(removed.accepted).toBe(true);
    expect(removed.state.revision).toBe(state.revision + 1);
    expect(removed.state.seats).toEqual([{ seat: 1, playerId: hostPlayerId, displayName: "Host" }]);
    expect(removed.state.partySlots).toEqual(state.partySlots);
    expect(hashSessionGameplayState(removed.state)).toBe(beforeHash);
    expect(removed.events).toContainEqual({ type: "SEAT_REMOVED", seat: 2, playerId: guestPlayerId });

    const begun = dispatch(removed.state, hostPlayerId, { type: "begin-adventure" }, [hostPlayerId]);
    expect(begun.accepted).toBe(true);
    expect(Object.keys(begun.state.adventure?.party.members ?? {})).toHaveLength(3);
    const activeRemoval = dispatch(begun.state, hostPlayerId, removeIntent, [hostPlayerId]);
    expect(activeRemoval.accepted).toBe(false);
    expect(activeRemoval.state).toBe(begun.state);
  });

  it("lets a 1P host edit every party member and uses all distinct starter profiles", () => {
    let state = prepare(lobby());
    state = dispatch(state, state.hostPlayerId, { type: "begin-adventure" }).state;
    expect(state.adventure?.collection.equipment).toEqual({
      halberd: 1,
      shield: 2,
      "boots-of-fly": 2,
    });
    for (const memberId of ["party.hero-1", "party.hero-2", "party.hero-3"]) {
      const member = state.adventure?.party.members[memberId];
      expect(member).toBeDefined();
      const result = dispatch(state, state.hostPlayerId, {
        type: "set-loadout",
        memberId,
        loadout: member?.loadout as NonNullable<typeof member>["loadout"],
      });
      expect(result.accepted).toBe(true);
      state = result.state;
    }
  });

  it("delegates an online claim and immediately falls back to host when that guest is offline", () => {
    let state = join(lobby(), player("player-b", "Guest B"));
    state = prepare(state);
    state = claim(state, "player-b", "party.hero-2");
    state = dispatch(state, state.hostPlayerId, { type: "begin-adventure" }).state;
    const lyra = state.adventure?.party.members["party.hero-2"];
    expect(lyra).toBeDefined();
    const intent: SessionIntent = {
      type: "set-loadout",
      memberId: "party.hero-2",
      loadout: lyra?.loadout as NonNullable<typeof lyra>["loadout"],
    };

    expect(dispatch(state, state.hostPlayerId, intent).accepted).toBe(false);
    expect(dispatch(state, "player-b", intent).accepted).toBe(true);
    const fallback = dispatch(state, state.hostPlayerId, intent, [state.hostPlayerId]);
    expect(fallback.accepted).toBe(true);
    expect(fallback.state.adventure).toEqual(state.adventure);
    expect(dispatch(state, "player-b", intent, [state.hostPlayerId]).accepted).toBe(false);
  });

  it("excludes players, claims, and control from hash while party slot order remains gameplay input", () => {
    let first = readyThreePlayers("first", "session-first");
    let second = lobby("session-second", player("other-a", "Different Host"));
    second = join(second, player("other-b", "Other B"));
    second = join(second, player("other-c", "Other C"));
    second = prepare(second);
    second = claim(second, "other-b", "party.hero-3");
    second = claim(second, "other-c", "party.hero-2");

    expect(hashSessionGameplayState(first)).toBe(hashSessionGameplayState(second));
    first = beginAndStart(first);
    second = beginAndStart(second);
    expect(first.combat?.setupFingerprint).toBe(second.combat?.setupFingerprint);
    expect(hashCombatState(first.combat as NonNullable<typeof first.combat>)).toBe(
      hashCombatState(second.combat as NonNullable<typeof second.combat>),
    );
    expect(hashSessionGameplayState(first)).toBe(hashSessionGameplayState(second));

    const reordered = beginAndStart(prepare(lobby("session-reordered"), [
      "hero.brom",
      "hero.lyra",
      "hero.aerin",
    ]));
    expect(reordered.combat?.setupFingerprint).not.toBe(first.combat?.setupFingerprint);
    expect(hashSessionGameplayState(reordered)).not.toBe(hashSessionGameplayState(first));
  });
});
