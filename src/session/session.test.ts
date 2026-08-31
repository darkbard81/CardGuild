import { describe, expect, it } from "vitest";

import { M4_ADVENTURE_ID, M4_COMPILED_PACK } from "../content";
import { chooseAiCommand, hashCombatState, type CombatCommand } from "../game";
import {
  createSessionCoreState,
  dispatchServerCombatCommand,
  dispatchSessionIntent,
  hashSessionGameplayState,
  joinSessionCore,
} from ".";
import type {
  SessionAuthorityContext,
  SessionCoreState,
  SessionGameplayIntent,
  SessionPlayerIdentity,
} from "./types";

const context: SessionAuthorityContext = {
  pack: M4_COMPILED_PACK,
  adventureId: M4_ADVENTURE_ID,
  actorDefinitionId: "hero.aerin",
};

function player(playerId: string, displayName = playerId): SessionPlayerIdentity {
  return { playerId, displayName };
}

function lobby(sessionId = "session-a", host = player("player-a", "Host")): SessionCoreState {
  return createSessionCoreState({ ...host, sessionId, adventureSeed: 90210 }, context);
}

function joinedLobby(prefix = "player", sessionId = "session-a"): SessionCoreState {
  let state = lobby(sessionId, player(`${prefix}-a`, "Host"));
  state = joinSessionCore(state, player(`${prefix}-b`, "Guest B"), context).state;
  return joinSessionCore(state, player(`${prefix}-c`, "Guest C"), context).state;
}

function beginAndStart(state: SessionCoreState): SessionCoreState {
  const begun = dispatchSessionIntent(state, state.hostPlayerId, { type: "begin-adventure" }, context);
  expect(begun.accepted).toBe(true);
  const started = dispatchSessionIntent(begun.state, begun.state.hostPlayerId, { type: "start-encounter" }, context);
  expect(started.accepted).toBe(true);
  return started.state;
}

function pumpUntilHumanBoundary(state: SessionCoreState): SessionCoreState {
  let current = state;
  for (let count = 0; count < 100; count += 1) {
    const combat = current.combat;
    if (!combat || combat.outcome) return current;
    const pending = combat.pendingReaction;
    if (pending) {
      const head = combat.actors[pending.candidates[0]?.actorId ?? ""];
      if (!head || head.team === "heroes") return current;
      const result = dispatchServerCombatCommand(current, {
        type: "pass-reaction",
        id: "ignored-server-id",
        sequence: -1,
        actorId: head.id,
        triggerId: pending.triggerId,
      }, context);
      expect(result.accepted).toBe(true);
      current = result.state;
      continue;
    }
    const active = combat.actors[combat.turn.activeActorId];
    if (!active || active.team === "heroes") return current;
    const command = chooseAiCommand(combat, context.pack.combatContent);
    expect(command).not.toBeNull();
    const result = dispatchServerCombatCommand(current, command as CombatCommand, context);
    expect(result.accepted).toBe(true);
    current = result.state;
  }
  throw new Error("Server AI did not reach a human input boundary.");
}

function humanBoundaryIntent(state: SessionCoreState): { readonly playerId: string; readonly intent: SessionGameplayIntent } {
  const combat = state.combat as NonNullable<SessionCoreState["combat"]>;
  const actorId = combat.pendingReaction?.candidates[0]?.actorId ?? combat.turn.activeActorId;
  const seat = state.seats.find((candidate) => candidate.memberId === actorId);
  if (!seat) throw new Error(`No player owns human boundary actor "${actorId}".`);
  return combat.pendingReaction
    ? { playerId: seat.playerId, intent: { type: "pass-reaction", triggerId: combat.pendingReaction.triggerId } }
    : { playerId: seat.playerId, intent: { type: "end-turn" } };
}

describe("pure Session authority", () => {
  it("starts authoritative one-, two-, and three-player rosters from starter definitions", () => {
    for (const size of [1, 2, 3] as const) {
      let state = lobby(`session-${size}`);
      for (let seat = 2; seat <= size; seat += 1) {
        const joined = joinSessionCore(state, player(`player-${size}-${seat}`), context);
        expect(joined.accepted).toBe(true);
        state = joined.state;
      }
      const begun = dispatchSessionIntent(state, state.hostPlayerId, { type: "begin-adventure" }, context);
      expect(begun.accepted).toBe(true);
      expect(Object.keys(begun.state.adventure?.party.members ?? {})).toEqual(
        Array.from({ length: size }, (_, index) => `party.hero-${index + 1}`),
      );
      expect(begun.state.adventure?.collection.equipment).toEqual({
        halberd: size,
        shield: size,
        "boots-of-fly": size,
      });
    }
  });

  it("allocates seats 1-3, rejects a fourth player, and locks the roster on host begin", () => {
    let state = lobby();
    expect(state.seats.map((seat) => seat.seat)).toEqual([1]);
    expect(state.revision).toBe(0);

    state = joinSessionCore(state, player("player-b"), context).state;
    state = joinSessionCore(state, player("player-c"), context).state;
    expect(state.seats.map((seat) => [seat.seat, seat.memberId])).toEqual([
      [1, "party.hero-1"],
      [2, "party.hero-2"],
      [3, "party.hero-3"],
    ]);
    expect(state.revision).toBe(2);

    const full = joinSessionCore(state, player("player-d"), context);
    expect(full.accepted).toBe(false);
    expect(full.errorCode).toBe("SESSION_FULL");
    expect(full.state).toBe(state);

    const nonHost = dispatchSessionIntent(state, "player-b", { type: "begin-adventure" }, context);
    expect(nonHost.accepted).toBe(false);
    expect(nonHost.errorCode).toBe("FORBIDDEN");
    expect(nonHost.state).toBe(state);

    const begun = dispatchSessionIntent(state, "player-a", { type: "begin-adventure" }, context);
    expect(begun.accepted).toBe(true);
    expect(begun.state.lifecycle).toBe("active");
    expect(begun.state.adventure?.collection.equipment).toEqual({
      halberd: 3,
      shield: 3,
      "boots-of-fly": 3,
    });
    const late = joinSessionCore(begun.state, player("player-d"), context);
    expect(late.accepted).toBe(false);
    expect(late.errorCode).toBe("ROSTER_LOCKED");
    expect(late.state).toBe(begun.state);
  });

  it("enforces host-only shared decisions and derives every personal command from the authenticated seat", () => {
    let state = joinedLobby();
    state = dispatchSessionIntent(state, state.hostPlayerId, { type: "begin-adventure" }, context).state;

    const guestStart = dispatchSessionIntent(state, "player-b", { type: "start-encounter" }, context);
    expect(guestStart.accepted).toBe(false);
    expect(guestStart.errorCode).toBe("FORBIDDEN");
    expect(guestStart.state).toBe(state);

    const guestLoadout = dispatchSessionIntent(state, "player-b", {
      type: "set-loadout",
      loadout: { equipment: { weapon: "halberd", feet: "boots-of-fly" }, preparedCards: [] },
    }, context);
    expect(guestLoadout.accepted).toBe(true);
    expect(guestLoadout.state.adventure?.party.members["party.hero-2"]?.loadout.equipment.shield).toBeUndefined();
    expect(guestLoadout.state.adventure?.party.members["party.hero-1"]?.loadout.equipment.shield).toBe("shield");

    const reward = context.pack.adventures[context.adventureId]?.rewards[0];
    expect(reward).toBeDefined();
    const rewardState: SessionCoreState = {
      ...guestLoadout.state,
      adventure: {
        ...(guestLoadout.state.adventure as NonNullable<SessionCoreState["adventure"]>),
        phase: "reward",
        pendingReward: {
          rewardId: reward?.id as string,
          encounterId: reward?.afterEncounterId as string,
          choices: reward?.choices ?? [],
        },
      },
    };
    const guestReward = dispatchSessionIntent(rewardState, "player-b", {
      type: "choose-reward",
      rewardId: reward?.id as string,
      choiceIndex: 0,
    }, context);
    expect(guestReward.accepted).toBe(false);
    expect(guestReward.errorCode).toBe("FORBIDDEN");
    expect(guestReward.state).toBe(rewardState);

    const started = dispatchSessionIntent(guestLoadout.state, guestLoadout.state.hostPlayerId, {
      type: "start-encounter",
    }, context);
    expect(started.accepted).toBe(true);
    expect(started.state.adventure?.phase).toBe("combat");
    expect(started.state.combat?.scenarioId).toBe(started.state.adventure?.currentEncounterId);
    expect(started.state.combat?.actors["party.hero-2"]?.equipmentIds).not.toContain("shield");
  });

  it("excludes transport identity from gameplay hash and deterministic Combat command IDs", () => {
    let first = beginAndStart(joinedLobby("first", "session-first"));
    let second = beginAndStart(joinedLobby("other", "session-second"));

    expect(hashSessionGameplayState(first)).toBe(hashSessionGameplayState(second));
    expect(first.combat?.setupFingerprint).toBe(second.combat?.setupFingerprint);
    expect(hashCombatState(first.combat as NonNullable<typeof first.combat>)).toBe(
      hashCombatState(second.combat as NonNullable<typeof second.combat>),
    );

    first = pumpUntilHumanBoundary(first);
    second = pumpUntilHumanBoundary(second);
    const firstBoundary = humanBoundaryIntent(first);
    const secondBoundary = humanBoundaryIntent(second);
    const firstResult = dispatchSessionIntent(first, firstBoundary.playerId, firstBoundary.intent, context);
    const secondResult = dispatchSessionIntent(second, secondBoundary.playerId, secondBoundary.intent, context);
    expect(firstResult.accepted).toBe(true);
    expect(secondResult.accepted).toBe(true);
    expect(firstResult.state.combat?.commandLog.at(-1)?.id).toMatch(/^combat-\d{6}-(end-turn|pass-reaction)$/);
    expect(firstResult.state.combat?.commandLog.at(-1)?.id).toBe(secondResult.state.combat?.commandLog.at(-1)?.id);
    expect(hashSessionGameplayState(firstResult.state)).toBe(hashSessionGameplayState(secondResult.state));

    const ownerMemberId = first.seats.find((seat) => seat.playerId === firstBoundary.playerId)?.memberId;
    const otherPlayer = first.seats.find((seat) => seat.memberId !== ownerMemberId)?.playerId as string;
    const forbidden = dispatchSessionIntent(first, otherPlayer, firstBoundary.intent, context);
    expect(forbidden.accepted).toBe(false);
    expect(forbidden.errorCode).toBe("FORBIDDEN");
    expect(forbidden.state).toBe(first);
    expect(forbidden.state.revision).toBe(first.revision);
  });
});
