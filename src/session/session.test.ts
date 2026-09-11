import { describe, expect, it } from "vitest";

import { PRODUCTION_CONTENT } from "../content";
import { hashCombatState } from "../game";
import {
  createResumedSessionCoreState,
  createSessionCoreState,
  assertSessionInvariants,
  dispatchSessionIntent,
  hashSessionGameplayState,
  joinSessionCore,
} from ".";
import type {
  SessionAuthorityContext,
  SessionControlContext,
  SessionCoreState,
  SessionGameplayProjection,
  SessionIntent,
  SessionPlayerIdentity,
  SessionTransitionResult,
} from "./types";

const context: SessionAuthorityContext = {
  pack: PRODUCTION_CONTENT.pack,
  adventureId: PRODUCTION_CONTENT.adventureId,
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
  it("hashes runtime Level and EXP, preserves them through JSON, and rejects invalid Adventure state", () => {
    const initial = beginAndStart(prepare(lobby()));
    const memberId = "party.hero-1";
    const stateWith = (level: number, experience: number): SessionCoreState => ({
      ...initial,
      adventure: { ...initial.adventure!, party: { members: {
        ...initial.adventure!.party.members,
        [memberId]: { ...initial.adventure!.party.members[memberId]!, progression: { level, experience } },
      } } },
    });
    const hash = hashSessionGameplayState(initial);
    for (const changed of [stateWith(2, 0), stateWith(1, 375)]) {
      assertSessionInvariants(changed);
      expect(hashSessionGameplayState(changed)).not.toBe(hash);
      const decoded = JSON.parse(JSON.stringify(changed)) as SessionCoreState;
      assertSessionInvariants(decoded);
      expect(decoded).toEqual(changed);
      expect(hashSessionGameplayState(decoded)).toBe(hashSessionGameplayState(changed));
      expect(hashCombatState(decoded.combat!)).toBe(hashCombatState(initial.combat!));
    }
    expect(() => assertSessionInvariants(stateWith(1, 1000))).toThrow("experience");
    expect(() => assertSessionInvariants({ ...initial, adventure: { ...initial.adventure!, version: 2 } } as unknown as SessionCoreState)).toThrow("version 3");
  });
  it("authorizes and commits final facing plus End Turn as one revision", () => {
    const state = beginAndStart(readyThreePlayers());
    const combat = state.combat!;
    const actorId = combat.turn.activeActorId;
    const owner = control(state).effectiveControllerByMemberId[actorId]!;
    const other = state.seats.find((seat) => seat.playerId !== owner)!.playerId;
    const facing = combat.actors[actorId]!.facing === "west" ? "east" : "west";
    const denied = dispatch(state, other, { type: "end-turn", facing });
    expect(denied.accepted).toBe(false);
    expect(denied.state).toBe(state);
    const result = dispatch(state, owner, { type: "end-turn", facing });
    expect(result.accepted).toBe(true);
    expect(result.state.revision).toBe(state.revision + 1);
    expect(result.state.combat?.sequence).toBe(combat.sequence + 1);
    expect(result.state.combat?.actors[actorId]?.facing).toBe(facing);
    expect(result.state.combat?.commandLog.at(-1)).toMatchObject({ type: "end-turn", facing, actorId });
    expect(result.events.findIndex((event) => event.type === "FACING_CHANGED"))
      .toBeLessThan(result.events.findIndex((event) => event.type === "TURN_ENDED"));
    expect(result.events.some((event) => event.type === "ACTION_SPENT")).toBe(false);
  });
  it("keeps player seats separate and prepares deterministic 1/2/3-character parties", () => {
    for (const size of [1, 2, 3] as const) {
      const state = prepare(lobby("session-" + String(size)), DEFAULT_PARTY.slice(0, size));
      expect(state.version).toBe(3);
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

  it("rejects a join when party capacity is full despite a hole in player seat numbers", () => {
    let state = join(lobby(), player("player-b", "Guest B"));
    state = join(state, player("player-c", "Guest C"));
    const removed = dispatch(
      state,
      state.hostPlayerId,
      { type: "remove-offline-guest", playerId: "player-b" },
      [state.hostPlayerId, "player-c"],
    );
    expect(removed.accepted).toBe(true);
    state = prepare(removed.state, ["hero.aerin", "hero.lyra"]);
    expect(state.seats.map((seat) => seat.seat)).toEqual([1, 3]);

    const full = joinSessionCore(state, player("player-d", "Guest D"), context);

    expect(full.accepted).toBe(false);
    expect(full.errorCode).toBe("SESSION_FULL");
    expect(full.state).toBe(state);
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
      "guardian-mace": 1,
      halberd: 1,
      "light-blade": 1,
      shield: 2,
      "boots-of-fly": 2,
      "scale-mail": 1,
      "leather-armor": 1,
      "half-plate": 1,
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

function projectionOf(state: SessionCoreState): SessionGameplayProjection {
  const adventure = state.adventure;
  if (!adventure) throw new Error("Fixture state has no AdventureState.");
  return {
    contentIdentity: state.contentIdentity,
    partySlots: state.partySlots,
    adventure,
    combat: state.combat,
  };
}

function resumed(saved: SessionCoreState, sessionId = "session-resumed"): SessionCoreState {
  return createResumedSessionCoreState(
    { sessionId, playerId: "player-resumed-host", displayName: "Resumed Host" },
    projectionOf(saved),
    context,
  );
}

describe("resume lobby", () => {
  it("rehydrates saved gameplay into a fresh session with the same gameplay hash", () => {
    const saved = beginAndStart(readyThreePlayers());
    const state = resumed(saved);

    expect(state.version).toBe(3);
    expect(state.lifecycle).toBe("resume-lobby");
    expect(state.sessionId).not.toBe(saved.sessionId);
    expect(state.hostPlayerId).not.toBe(saved.hostPlayerId);
    expect(state.revision).toBe(0);
    expect(state.seats).toEqual([{ seat: 1, playerId: "player-resumed-host", displayName: "Resumed Host" }]);
    expect(state.guestClaims).toEqual({ byMemberId: {} });
    expect(state.partyPrepared).toBe(true);
    expect(state.partySlots).toEqual(saved.partySlots);
    expect(state.adventure).toEqual(saved.adventure);
    expect(state.combat).toEqual(saved.combat);
    // The seed is read back from the Adventure rather than stored beside it.
    expect(state.adventureSeed).toBe(saved.adventure?.adventureSeed);
    expect(hashSessionGameplayState(state)).toBe(hashSessionGameplayState(saved));
    // No trace of the session that saved it survives in the restored state.
    const encoded = JSON.stringify(state);
    for (const stale of [saved.sessionId, saved.hostPlayerId, "player-b", "player-c"]) {
      expect(encoded).not.toContain(stale);
    }
  });

  it("forbids every gameplay intent until the host resumes", () => {
    const saved = beginAndStart(prepare(lobby()));
    const state = resumed(saved);
    const member = state.adventure?.party.members["party.hero-1"];
    const combat = state.combat;
    if (!member || !combat) throw new Error("Fixture is missing saved gameplay.");
    const forbidden: readonly SessionIntent[] = [
      { type: "set-party-composition", actorDefinitionIds: ["hero.brom"] },
      { type: "begin-adventure" },
      { type: "start-encounter" },
      { type: "choose-reward", rewardId: "reward.any", choiceIndex: 0 },
      { type: "set-loadout", memberId: "party.hero-1", loadout: member.loadout },
      { type: "use-action", action: { kind: "basic", id: "stride" }, target: { kind: "none" } },
      { type: "end-turn", facing: "north" },
      { type: "use-reaction", triggerId: "trigger", cardInstanceId: "card" },
      { type: "pass-reaction", triggerId: "trigger" },
    ];

    for (const intent of forbidden) {
      const result = dispatch(state, state.hostPlayerId, intent);
      expect(result.accepted, intent.type).toBe(false);
      expect(result.errorCode, intent.type).toBe("FORBIDDEN");
      expect(result.state, intent.type).toBe(state);
    }
    // Saved combat is present, so the guard cannot be relying on its absence.
    expect(state.combat).not.toBeNull();
  });

  it("lets a fresh guest join and reclaim a saved character before Resume", () => {
    const saved = beginAndStart(readyThreePlayers());
    let state = resumed(saved);

    state = join(state, player("player-new-guest", "New Guest"));
    expect(state.seats.map((seat) => seat.seat)).toEqual([1, 2]);
    state = claim(state, "player-new-guest", "party.hero-3");
    expect(state.guestClaims.byMemberId).toEqual({ "party.hero-3": "player-new-guest" });
    // Reclaiming changes no gameplay, so the restored hash still matches the save.
    expect(hashSessionGameplayState(state)).toBe(hashSessionGameplayState(saved));

    const removable = dispatch(state, state.hostPlayerId, {
      type: "remove-offline-guest",
      playerId: "player-new-guest",
    }, [state.hostPlayerId]);
    // A guest holding a claim still cannot be removed, exactly as in a new lobby.
    expect(removable.accepted).toBe(false);
  });

  it("resumes on the host's word alone, changing lifecycle and nothing else", () => {
    const saved = beginAndStart(readyThreePlayers());
    let state = resumed(saved);
    state = join(state, player("player-idle-guest", "Idle Guest"));

    expect(dispatch(state, "player-idle-guest", { type: "resume-adventure" }).accepted).toBe(false);
    // A guest who joined without choosing a character does not block Resume: unclaimed
    // saved characters fall back to the host under the existing control rules.
    const result = dispatch(state, state.hostPlayerId, { type: "resume-adventure" });

    expect(result.accepted).toBe(true);
    expect(result.events).toEqual([]);
    expect(result.state.lifecycle).toBe("active");
    expect(result.state.revision).toBe(state.revision + 1);
    expect(result.state.adventure).toEqual(state.adventure);
    expect(result.state.combat).toEqual(state.combat);
    expect(result.state.seats).toEqual(state.seats);
    expect(hashSessionGameplayState(result.state)).toBe(hashSessionGameplayState(saved));
    // Resume is not repeatable, and a live session never re-enters the resume lobby.
    expect(dispatch(result.state, result.state.hostPlayerId, { type: "resume-adventure" }).accepted).toBe(false);
    expect(joinSessionCore(result.state, player("player-late"), context).errorCode).toBe("ROSTER_LOCKED");
  });

  it("plays on from the resumed state at the same combat sequence", () => {
    const saved = beginAndStart(prepare(lobby()));
    const state = dispatch(resumed(saved), "player-resumed-host", { type: "resume-adventure" }).state;
    const actorId = state.combat?.turn.activeActorId;
    if (!actorId) throw new Error("Restored combat has no active actor.");

    const played = dispatch(state, state.hostPlayerId, { type: "end-turn", facing: "east" });

    expect(played.accepted).toBe(true);
    expect(played.state.combat?.sequence).toBe((saved.combat?.sequence ?? 0) + 1);
    expect(hashSessionGameplayState(played.state)).not.toBe(hashSessionGameplayState(saved));
  });

  it("refuses to restore gameplay that cannot form a valid session", () => {
    const saved = beginAndStart(prepare(lobby()));
    const projection = projectionOf(saved);

    expect(() => createResumedSessionCoreState(
      { sessionId: "session-broken", playerId: "player-broken", displayName: "Host" },
      { ...projection, partySlots: projection.partySlots.slice(1) },
      context,
    )).toThrow();
    expect(() => createResumedSessionCoreState(
      { sessionId: "session-broken", playerId: "player-broken", displayName: "Host" },
      { ...projection, combat: null },
      context,
    )).toThrow("atomically");
  });
});
