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
  SessionControlContext,
  SessionCoreState,
  SessionEvent,
  SessionIntent,
  SessionPartySlot,
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
  if (!definition) throw new Error('Adventure "' + context.adventureId + '" is missing.');
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

export function memberIdForPartySlot(slot: SessionSeatNumber): string {
  return "party.hero-" + String(slot);
}

function makeSeat(seat: SessionSeatNumber, player: SessionPlayerIdentity): SessionSeat {
  return { seat, playerId: player.playerId, displayName: player.displayName };
}

function playableCharacter(context: SessionAuthorityContext, actorDefinitionId: string): boolean {
  return Boolean(
    context.pack.actorDefinitions[actorDefinitionId]?.traits.some((trait) => trait.id === "playable"),
  );
}

export function createSessionCoreState(
  options: CreateSessionOptions,
  context: SessionAuthorityContext,
): SessionCoreState {
  if (!Number.isInteger(options.adventureSeed)) throw new Error("Adventure seed must be an integer.");
  adventureContext(context);
  const state: SessionCoreState = {
    version: 2,
    sessionId: options.sessionId,
    revision: 0,
    contentIdentity: getContentIdentity(context.pack),
    lifecycle: "lobby",
    hostPlayerId: options.playerId,
    adventureSeed: options.adventureSeed,
    seats: [makeSeat(1, options)],
    partyPrepared: false,
    partySlots: [],
    guestClaims: { byMemberId: {} },
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
  const adventureMaximum = adventureContext(context).definition.partySize.max;
  const maximum = state.partyPrepared ? Math.min(adventureMaximum, state.partySlots.length) : adventureMaximum;
  const occupied = new Set(state.seats.map((seat) => seat.seat));
  const seat = ([1, 2, 3] as const).find((candidate) => candidate <= maximum && !occupied.has(candidate));
  if (!seat) return reject(state, "SESSION_FULL", "Session has no player seat within the prepared party capacity.");
  const joined = makeSeat(seat, player);
  return commit(state, {
    ...state,
    seats: [...state.seats, joined].sort((left, right) => left.seat - right.seat),
  }, [{ type: "SEAT_JOINED", seat }]);
}

function partyFromSlots(state: SessionCoreState, context: SessionAuthorityContext): PartyState {
  return {
    members: Object.fromEntries(state.partySlots.map((partySlot) => {
      const definition = context.pack.actorDefinitions[partySlot.actorDefinitionId];
      if (!definition) throw new Error('Actor definition "' + partySlot.actorDefinitionId + '" is missing.');
      return [partySlot.memberId, {
        id: partySlot.memberId,
        seat: partySlot.slot,
        actorDefinitionId: partySlot.actorDefinitionId,
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
  if (!result.accepted) throw new Error("Server failed to finalize combat: " + (result.error ?? "unknown error"));
  return { adventure: result.state, combat: null, events: [...events, ...result.events] };
}

function deterministicCommandId(sequence: number, type: CombatCommand["type"]): string {
  return "combat-" + String(sequence).padStart(6, "0") + "-" + type;
}

function combatCommandForIntent(
  state: SessionCoreState,
  intent: Extract<SessionIntent, { type: "use-action" | "end-turn" | "use-reaction" | "pass-reaction" }>,
): CombatCommand {
  const combat = state.combat as NonNullable<SessionCoreState["combat"]>;
  const sequence = combat.sequence + 1;
  const actorId = intent.type === "use-reaction" || intent.type === "pass-reaction"
    ? combat.pendingReaction?.candidates[0]?.actorId
    : combat.turn.activeActorId;
  if (!actorId) throw new Error("Authoritative combat state has no actionable actor.");
  const base = { id: deterministicCommandId(sequence, intent.type), sequence, actorId };
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

function setPartyComposition(
  state: SessionCoreState,
  actorDefinitionIds: readonly string[],
  context: SessionAuthorityContext,
): SessionTransitionResult {
  const maximum = adventureContext(context).definition.partySize.max;
  if (actorDefinitionIds.length < 1 || actorDefinitionIds.length > maximum) {
    return reject(state, "DOMAIN_REJECTED", "Party must contain between 1 and " + String(maximum) + " characters.");
  }
  if (actorDefinitionIds.length < state.seats.length) {
    return reject(state, "DOMAIN_REJECTED", "Party cannot be smaller than the current player roster.");
  }
  if (new Set(actorDefinitionIds).size !== actorDefinitionIds.length) {
    return reject(state, "DOMAIN_REJECTED", "Party characters must be unique.");
  }
  for (const actorDefinitionId of actorDefinitionIds) {
    if (!context.pack.actorDefinitions[actorDefinitionId]) {
      return reject(state, "DOMAIN_REJECTED", 'Actor definition "' + actorDefinitionId + '" is unknown.');
    }
    if (!playableCharacter(context, actorDefinitionId)) {
      return reject(state, "DOMAIN_REJECTED", 'Actor definition "' + actorDefinitionId + '" is not playable.');
    }
  }
  if (
    state.partyPrepared &&
    actorDefinitionIds.length === state.partySlots.length &&
    actorDefinitionIds.every((actorDefinitionId, index) =>
      actorDefinitionId === state.partySlots[index]?.actorDefinitionId)
  ) {
    return reject(state, "DOMAIN_REJECTED", "Party composition is already applied.");
  }
  const partySlots = actorDefinitionIds.map((actorDefinitionId, index): SessionPartySlot => {
    const slot = (index + 1) as SessionSeatNumber;
    return { slot, memberId: memberIdForPartySlot(slot), actorDefinitionId };
  });
  return commit(state, {
    ...state,
    partyPrepared: true,
    partySlots,
    guestClaims: { byMemberId: {} },
  }, [{ type: "PARTY_COMPOSITION_SET", memberIds: partySlots.map((slot) => slot.memberId) }]);
}

function selectCharacter(
  state: SessionCoreState,
  playerId: string,
  memberId: string,
): SessionTransitionResult {
  const slot = state.partySlots.find((candidate) => candidate.memberId === memberId);
  if (!slot) return reject(state, "DOMAIN_REJECTED", "Selected character is not in the prepared party.");
  if (slot.slot === 1) return reject(state, "FORBIDDEN", "Party Slot 1 is the Host Character.");
  const currentClaimant = state.guestClaims.byMemberId[memberId];
  if (currentClaimant === playerId) {
    return reject(state, "DOMAIN_REJECTED", "Character is already selected by this guest.");
  }
  if (currentClaimant && currentClaimant !== playerId) {
    return reject(state, "CHARACTER_TAKEN", "Another guest already claimed this character.");
  }
  const byMemberId = Object.fromEntries(
    Object.entries(state.guestClaims.byMemberId)
      .filter(([, claimant]) => claimant !== playerId),
  );
  byMemberId[memberId] = playerId;
  return commit(state, {
    ...state,
    guestClaims: { byMemberId },
  }, [{ type: "CHARACTER_SELECTED", playerId, memberId }]);
}

export function dispatchSessionIntent(
  state: SessionCoreState,
  playerId: string,
  intent: SessionIntent,
  context: SessionAuthorityContext,
  control: SessionControlContext,
): SessionTransitionResult {
  const authorizationError = authorizeSessionIntent(state, playerId, intent, control);
  if (authorizationError) {
    const errorCode = intent.type === "begin-adventure" && !state.partyPrepared
      ? "PARTY_NOT_PREPARED"
      : "FORBIDDEN";
    return reject(state, errorCode, authorizationError);
  }
  const runtime = adventureContext(context);

  switch (intent.type) {
    case "set-party-composition":
      return setPartyComposition(state, intent.actorDefinitionIds, context);
    case "select-character":
      return selectCharacter(state, playerId, intent.memberId);
    case "remove-offline-guest": {
      const guestSeat = seatForPlayer(state, intent.playerId);
      if (!guestSeat) return reject(state, "DOMAIN_REJECTED", "Guest seat does not exist.");
      return commit(state, {
        ...state,
        seats: state.seats.filter((seat) => seat.playerId !== intent.playerId),
      }, [{ type: "SEAT_REMOVED", seat: guestSeat.seat, playerId: intent.playerId }]);
    }
    case "begin-adventure": {
      const ready = createAdventureSession(runtime, partyFromSlots(state, context), state.adventureSeed);
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
      const result = dispatchAdventureCommand(state.adventure as AdventureState, {
        type: "set-member-loadout",
        memberId: intent.memberId,
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
      const result = dispatchCombatCommand(combat, combatCommandForIntent(state, intent), context.pack.combatContent);
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
  if (state.version !== 2) throw new Error("SessionCoreState must use version 2.");
  const seatNumbers = state.seats.map((seat) => seat.seat);
  const playerIds = state.seats.map((seat) => seat.playerId);
  if (new Set(seatNumbers).size !== seatNumbers.length || new Set(playerIds).size !== playerIds.length) {
    throw new Error("Session player seats and player identities must be unique.");
  }
  if (!state.seats.some((seat) => seat.playerId === state.hostPlayerId && seat.seat === 1)) {
    throw new Error("The host must own player seat 1.");
  }
  if (state.partyPrepared !== (state.partySlots.length > 0)) {
    throw new Error("Prepared party state must match the presence of party slots.");
  }
  if (state.partySlots.length > 3 || (state.partyPrepared && state.partySlots.length < 1)) {
    throw new Error("Prepared parties must contain one to three characters.");
  }
  if (state.partyPrepared && state.partySlots.length < state.seats.length) {
    throw new Error("Prepared party cannot be smaller than the player roster.");
  }
  const slots = state.partySlots.map((slot) => slot.slot);
  const members = state.partySlots.map((slot) => slot.memberId);
  const actors = state.partySlots.map((slot) => slot.actorDefinitionId);
  if (new Set(slots).size !== slots.length || new Set(members).size !== members.length || new Set(actors).size !== actors.length) {
    throw new Error("Party slot, member, and character identities must be unique.");
  }
  for (const [index, slot] of state.partySlots.entries()) {
    if (slot.slot !== index + 1 || slot.memberId !== memberIdForPartySlot(slot.slot)) {
      throw new Error("Party slots must be ordered and use deterministic member IDs.");
    }
  }
  const claimedPlayers = new Set<string>();
  for (const [memberId, playerId] of Object.entries(state.guestClaims.byMemberId)) {
    const slot = state.partySlots.find((candidate) => candidate.memberId === memberId);
    if (!slot || slot.slot === 1) throw new Error("Guest claims may only target Party Slot 2 or 3.");
    if (playerId === state.hostPlayerId || !state.seats.some((seat) => seat.playerId === playerId)) {
      throw new Error("Guest claims must reference a current non-host player.");
    }
    if (claimedPlayers.has(playerId)) throw new Error("A guest may claim only one character.");
    claimedPlayers.add(playerId);
  }
  const combatPhase = state.adventure?.phase === "combat";
  if (combatPhase !== Boolean(state.combat)) throw new Error("Adventure combat phase and CombatState must change atomically.");
  if (state.lifecycle === "lobby" && (state.adventure || state.combat)) {
    throw new Error("Lobby sessions cannot expose AdventureState or CombatState.");
  }
  if (state.lifecycle === "active" && (!state.partyPrepared || !state.adventure)) {
    throw new Error("Active sessions require a prepared party and AdventureState.");
  }
  if (state.adventure) {
    const adventureMembers = Object.values(state.adventure.party.members)
      .sort((left, right) => left.seat - right.seat)
      .map((member) => [member.seat, member.id, member.actorDefinitionId]);
    const configuredMembers = state.partySlots
      .map((slot) => [slot.slot, slot.memberId, slot.actorDefinitionId]);
    if (JSON.stringify(adventureMembers) !== JSON.stringify(configuredMembers)) {
      throw new Error("Active Adventure party identity must match the prepared party slots.");
    }
  }
  if (state.combat) {
    if (state.combat.scenarioId !== state.adventure?.currentEncounterId) {
      throw new Error("Combat scenario must match the active Adventure encounter.");
    }
    if (!sameContentIdentity(state.combat.contentIdentity, state.contentIdentity)) {
      throw new Error("Combat content identity must match the Session content identity.");
    }
  }
}
