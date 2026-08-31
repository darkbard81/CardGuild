import {
  buildAdventureEncounter,
  createAdventureSession,
  dispatchAdventureCommand,
  type AdventureRuntimeContext,
  type AdventureState,
  type PartyState,
} from "../adventure";
import { getContentIdentity } from "../content";
import {
  createCombat,
  dispatchCombatCommand,
  hashCombatState,
  type CombatCommand,
  type CombatEvent,
} from "../game";
import { clonePartyLoadout } from "../loadout";
import { authorizeSessionIntent, seatForPlayer } from "./authorization";
import { sameContentIdentity } from "./session-hash";
import type {
  CreateSessionOptions,
  SessionAuthorityContext,
  SessionCoreState,
  SessionEvent,
  SessionGameplayIntent,
  SessionPlayerIdentity,
  SessionSeat,
  SessionSeatNumber,
  SessionTransitionResult,
} from "./types";

function reject(
  state: SessionCoreState,
  errorCode: NonNullable<SessionTransitionResult["errorCode"]>,
  error: string,
): SessionTransitionResult {
  return { accepted: false, state, events: [], errorCode, error };
}
function adventureContext(context: SessionAuthorityContext): AdventureRuntimeContext {
  const definition = context.pack.adventures[context.adventureId];
  if (!definition) throw new Error(`Adventure "${context.adventureId}" is missing.`);
  return {
    definition,
    actorDefinitions: context.pack.actorDefinitions,
    combatContent: context.pack.combatContent,
  };
}

function commit(
  previous: SessionCoreState,
  next: Omit<SessionCoreState, "revision">,
  events: readonly SessionEvent[],
): SessionTransitionResult {
  const state: SessionCoreState = { ...next, revision: previous.revision + 1 };
  assertSessionInvariants(state);
  return { accepted: true, state, events };
}

function memberIdForSeat(seat: SessionSeatNumber): string {
  return `party.hero-${seat}`;
}

function makeSeat(
  seat: SessionSeatNumber,
  player: SessionPlayerIdentity,
  actorDefinitionId: string,
): SessionSeat {
  return {
    seat,
    playerId: player.playerId,
    memberId: memberIdForSeat(seat),
    actorDefinitionId,
    displayName: player.displayName,
  };
}

export function createSessionCoreState(
  options: CreateSessionOptions,
  context: SessionAuthorityContext,
): SessionCoreState {
  if (!Number.isInteger(options.adventureSeed)) throw new Error("Adventure seed must be an integer.");
  if (!context.pack.actorDefinitions[context.actorDefinitionId]) {
    throw new Error(`Actor definition "${context.actorDefinitionId}" is missing.`);
  }
  const state: SessionCoreState = {
    version: 1,
    sessionId: options.sessionId,
    revision: 0,
    contentIdentity: getContentIdentity(context.pack),
    lifecycle: "lobby",
    hostPlayerId: options.playerId,
    adventureSeed: options.adventureSeed,
    seats: [makeSeat(1, options, context.actorDefinitionId)],
    adventure: null,
    combat: null,
  };
  assertSessionInvariants(state);
  return state;
}

export function joinSessionCore(
  state: SessionCoreState,
  player: SessionPlayerIdentity,
  context: SessionAuthorityContext,
): SessionTransitionResult {
  if (state.lifecycle !== "lobby") return reject(state, "ROSTER_LOCKED", "Adventure roster is already locked.");
  if (seatForPlayer(state, player.playerId)) return reject(state, "FORBIDDEN", "Player already owns a seat.");
  const maximum = adventureContext(context).definition.partySize.max;
  const occupied = new Set(state.seats.map((seat) => seat.seat));
  const seat = ([1, 2, 3] as const).find((candidate) => candidate <= maximum && !occupied.has(candidate));
  if (!seat) return reject(state, "SESSION_FULL", "Session has no free seats.");
  const joined = makeSeat(seat, player, context.actorDefinitionId);
  return commit(state, {
    ...state,
    seats: [...state.seats, joined].sort((left, right) => left.seat - right.seat),
  }, [{ type: "SEAT_JOINED", seat, memberId: joined.memberId }]);
}

function partyFromSeats(state: SessionCoreState, context: SessionAuthorityContext): PartyState {
  return {
    members: Object.fromEntries(state.seats.map((seat) => {
      const definition = context.pack.actorDefinitions[seat.actorDefinitionId];
      if (!definition) throw new Error(`Actor definition "${seat.actorDefinitionId}" is missing.`);
      return [seat.memberId, {
        id: seat.memberId,
        seat: seat.seat,
        actorDefinitionId: seat.actorDefinitionId,
        loadout: clonePartyLoadout(definition.starterLoadout),
      }];
    })),
  };
}

function finalizeCombat(
  state: SessionCoreState,
  adventure: AdventureState,
  events: readonly CombatEvent[],
  context: SessionAuthorityContext,
): { readonly adventure: AdventureState; readonly combat: SessionCoreState["combat"]; readonly events: readonly SessionEvent[] } {
  const combat = state.combat;
  if (!combat?.outcome || !adventure.currentEncounterId) return { adventure, combat, events };
  const result = dispatchAdventureCommand(adventure, {
    type: "accept-combat-result",
    result: {
      encounterId: adventure.currentEncounterId,
      outcome: combat.outcome,
      combatSeed: combat.seed,
      finalCombatHash: hashCombatState(combat),
    },
  }, adventureContext(context));
  if (!result.accepted) throw new Error(`Server failed to finalize combat: ${result.error ?? "unknown error"}`);
  return { adventure: result.state, combat: null, events: [...events, ...result.events] };
}

function deterministicCommandId(sequence: number, type: CombatCommand["type"]): string {
  return `combat-${String(sequence).padStart(6, "0")}-${type}`;
}

function combatCommandForIntent(
  state: SessionCoreState,
  playerId: string,
  intent: Extract<SessionGameplayIntent, { type: "use-action" | "end-turn" | "use-reaction" | "pass-reaction" }>,
): CombatCommand {
  const combat = state.combat as NonNullable<SessionCoreState["combat"]>;
  const seat = seatForPlayer(state, playerId) as SessionSeat;
  const sequence = combat.sequence + 1;
  const base = { id: deterministicCommandId(sequence, intent.type), sequence, actorId: seat.memberId };
  switch (intent.type) {
    case "use-action":
      return { ...base, type: intent.type, action: intent.action, target: intent.target };
    case "end-turn":
      return { ...base, type: intent.type };
    case "use-reaction":
      return { ...base, type: intent.type, triggerId: intent.triggerId, cardInstanceId: intent.cardInstanceId };
    case "pass-reaction":
      return { ...base, type: intent.type, triggerId: intent.triggerId };
  }
}

export function dispatchSessionIntent(
  state: SessionCoreState,
  playerId: string,
  intent: SessionGameplayIntent,
  context: SessionAuthorityContext,
): SessionTransitionResult {
  const authorizationError = authorizeSessionIntent(state, playerId, intent);
  if (authorizationError) return reject(state, "FORBIDDEN", authorizationError);
  const runtime = adventureContext(context);

  switch (intent.type) {
    case "begin-adventure": {
      const ready = createAdventureSession(runtime, partyFromSeats(state, context), state.adventureSeed);
      const started = dispatchAdventureCommand(ready, { type: "start-adventure" }, runtime);
      if (!started.accepted) return reject(state, "DOMAIN_REJECTED", started.error ?? "Adventure rejected begin.");
      return commit(state, { ...state, lifecycle: "active", adventure: started.state }, started.events);
    }
    case "start-encounter": {
      const started = dispatchAdventureCommand(state.adventure as AdventureState, { type: "start-encounter" }, runtime);
      if (!started.accepted) return reject(state, "DOMAIN_REJECTED", started.error ?? "Adventure rejected encounter start.");
      const encounter = buildAdventureEncounter(context.pack, started.state);
      const setup = createCombat(encounter.definition, encounter.seed);
      return commit(state, { ...state, adventure: started.state, combat: setup.state }, [...started.events, ...setup.events]);
    }
    case "choose-reward": {
      const result = dispatchAdventureCommand(state.adventure as AdventureState, {
        type: "choose-reward",
        rewardId: intent.rewardId,
        choiceIndex: intent.choiceIndex,
      }, runtime);
      if (!result.accepted) return reject(state, "DOMAIN_REJECTED", result.error ?? "Adventure rejected reward choice.");
      return commit(state, { ...state, adventure: result.state }, result.events);
    }
    case "set-loadout": {
      const seat = seatForPlayer(state, playerId) as SessionSeat;
      const result = dispatchAdventureCommand(state.adventure as AdventureState, {
        type: "set-member-loadout",
        memberId: seat.memberId,
        loadout: intent.loadout,
      }, runtime);
      if (!result.accepted) return reject(state, "DOMAIN_REJECTED", result.error ?? "Adventure rejected loadout.");
      return commit(state, { ...state, adventure: result.state }, result.events);
    }
    case "use-action":
    case "end-turn":
    case "use-reaction":
    case "pass-reaction": {
      const combat = state.combat as NonNullable<SessionCoreState["combat"]>;
      const result = dispatchCombatCommand(combat, combatCommandForIntent(state, playerId, intent), context.pack.combatContent);
      if (!result.accepted) return reject(state, "DOMAIN_REJECTED", result.error ?? "Combat rejected intent.");
      const finalized = finalizeCombat({ ...state, combat: result.state }, state.adventure as AdventureState, result.events, context);
      return commit(state, {
        ...state,
        adventure: finalized.adventure,
        combat: finalized.combat,
      }, finalized.events);
    }
  }
}

export function dispatchServerCombatCommand(
  state: SessionCoreState,
  command: CombatCommand,
  context: SessionAuthorityContext,
): SessionTransitionResult {
  const combat = state.combat;
  if (!combat) return reject(state, "DOMAIN_REJECTED", "Session has no active combat.");
  const sequence = combat.sequence + 1;
  const normalized = { ...command, sequence, id: deterministicCommandId(sequence, command.type) } as CombatCommand;
  const result = dispatchCombatCommand(combat, normalized, context.pack.combatContent);
  if (!result.accepted) return reject(state, "DOMAIN_REJECTED", result.error ?? "Combat rejected server command.");
  const finalized = finalizeCombat({ ...state, combat: result.state }, state.adventure as AdventureState, result.events, context);
  return commit(state, { ...state, adventure: finalized.adventure, combat: finalized.combat }, finalized.events);
}

export function assertSessionInvariants(state: SessionCoreState): void {
  const combatPhase = state.adventure?.phase === "combat";
  if (combatPhase !== Boolean(state.combat)) throw new Error("Adventure combat phase and CombatState must change atomically.");
  if (state.lifecycle === "lobby" && (state.adventure || state.combat)) {
    throw new Error("Lobby sessions cannot expose AdventureState or CombatState.");
  }
  if (state.lifecycle === "active" && !state.adventure) throw new Error("Active sessions require AdventureState.");
  if (state.combat) {
    if (state.combat.scenarioId !== state.adventure?.currentEncounterId) {
      throw new Error("Combat scenario must match the active Adventure encounter.");
    }
    if (!sameContentIdentity(state.combat.contentIdentity, state.contentIdentity)) {
      throw new Error("Combat content identity must match the Session content identity.");
    }
  }
}
