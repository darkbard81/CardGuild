import { coopAdmissionRemaining, coopRemovedPlayers, departureState, isCoopCompanion, isCoopPreparation, withoutGuests } from "./coop";
import { isAuthoredPlayable } from "../character/member";
import { assertCharacterName, assertCreationPreset } from "../character/member";
import {
  buildAdventureEncounter,
  assertAdventureInvariants,
  createAdventureSession,
  dispatchAdventureCommand,
  type AdventureRuntimeContext,
  type AdventureState,
  type PartySetup,
} from "../adventure";
import { getContentIdentity } from "../content/compile-content";
import {
  createCombat,
  dispatchCombatCommand,
  hashCombatState,
  type CombatCommand,
  type CombatEvent,
} from "../game";
import { clonePartyLoadout, validatePartyLoadout } from "../loadout";
import { authorizeSessionIntent, seatForPlayer } from "./authorization";
import { sameContentIdentity } from "./session-hash";
import type {
  CreateSessionOptions,
  ResumeSessionOptions,
  SessionAuthorityContext,
  SessionControlContext,
  SessionCoreState,
  SessionEvent,
  SessionGameplayProjection,
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
    characterRules: context.pack.characterRules,
    creationPresets: context.pack.creationPresets,
    companions: context.pack.companions,
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
  const actor = context.pack.actorDefinitions[actorDefinitionId];
  return Boolean(actor && isAuthoredPlayable(actor, context.pack));
}

export function createSessionCoreState(
  options: CreateSessionOptions,
  context: SessionAuthorityContext,
): SessionCoreState {
  if (!Number.isInteger(options.adventureSeed)) throw new Error("Adventure seed must be an integer.");
  adventureContext(context);
  const state: SessionCoreState = {
    version: 5,
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
    coopAllowedMemberIds: [],
    adventure: null,
    combat: null,
  };
  assertSessionInvariants(state);
  return state;
}

/**
 * Rehydrate a durable Campaign save into a brand new live session. Only the gameplay
 * projection survives: the session gets a fresh ID, a fresh host player, an empty guest
 * claim map and revision 0, and it starts in `resume-lobby` so nothing plays until the
 * host presses Resume.
 */
export function createResumedSessionCoreState(
  options: ResumeSessionOptions,
  projection: SessionGameplayProjection,
  context: SessionAuthorityContext,
): SessionCoreState {
  adventureContext(context);
  const state: SessionCoreState = {
    version: 5,
    sessionId: options.sessionId,
    revision: 0,
    contentIdentity: projection.contentIdentity,
    lifecycle: "resume-lobby",
    hostPlayerId: options.playerId,
    // The seed is not stored twice: the saved Adventure already carries the one it ran with.
    adventureSeed: projection.adventure.adventureSeed,
    seats: [makeSeat(1, options)],
    partyPrepared: true,
    partySlots: projection.partySlots.map((slot) => ({ ...slot })),
    guestClaims: { byMemberId: {} },
    coopAllowedMemberIds: [],
    adventure: structuredClone(projection.adventure),
    combat: structuredClone(projection.combat),
  };
  assertSessionInvariants(state);
  return state;
}

export function joinSessionCore(
  state: SessionCoreState,
  player: SessionPlayerIdentity,
  context: SessionAuthorityContext,
): SessionTransitionResult {
  if (!isCoopPreparation(state)) return reject(state, "ROSTER_LOCKED", "New guests may join only during preparation.");
  if (seatForPlayer(state, player.playerId)) return reject(state, "FORBIDDEN", "Player already owns a seat.");
  if (!state.coopAllowedMemberIds.length) return reject(state, "FORBIDDEN", "The host has not shared any companions.");
  const adventureMaximum = adventureContext(context).definition.partySize.max;
  if (coopAdmissionRemaining(state) < 1) return reject(state, "SESSION_FULL", "All shared companion admissions are reserved.");
  const occupied = new Set(state.seats.map((seat) => seat.seat));
  const seat = ([1, 2, 3] as const).find((candidate) => candidate <= adventureMaximum && !occupied.has(candidate));
  if (!seat) return reject(state, "SESSION_FULL", "Session has no player seat within the prepared party capacity.");
  const joined = makeSeat(seat, player);
  return commit(state, {
    ...state,
    seats: [...state.seats, joined].sort((left, right) => left.seat - right.seat),
  }, [{ type: "SEAT_JOINED", seat }]);
}

function partyFromSlots(state: SessionCoreState, context: SessionAuthorityContext): PartySetup {
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
  intent: Extract<SessionIntent, { type: "complete-scene" | "use-action" | "end-turn" | "use-reaction" | "pass-reaction" }>,
): CombatCommand {
  const combat = state.combat as NonNullable<SessionCoreState["combat"]>;
  const sequence = combat.sequence + 1;
  const actorId = intent.type === "use-reaction" || intent.type === "pass-reaction"
    ? combat.pendingReaction?.candidates[0]?.actorId
    : combat.turn.activeActorId;
  if (!actorId) throw new Error("Authoritative combat state has no actionable actor.");
  const base = { id: deterministicCommandId(sequence, intent.type), sequence, actorId };
  switch (intent.type) {
    case "complete-scene":
      return { ...base, type: intent.type, sceneId: intent.sceneId };
    case "use-action":
      return { ...base, type: intent.type, action: intent.action, target: intent.target };
    case "end-turn":
      return { ...base, type: intent.type, facing: intent.facing };
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
  const definition = adventureContext(context).definition;
  if (definition.rewards.some(reward => reward.choices.some(choice => choice.kind === "companion"))) {
    return reject(state, "DOMAIN_REJECTED", "Recruitment adventures require one created protagonist.");
  }
  const maximum = definition.partySize.max;
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
    coopAllowedMemberIds: [],
  }, [{ type: "PARTY_COMPOSITION_SET", memberIds: partySlots.map((slot) => slot.memberId) }]);
}

function selectCharacter(
  state: SessionCoreState,
  playerId: string,
  memberId: string,
): SessionTransitionResult {
  const slot = state.partySlots.find((candidate) => candidate.memberId === memberId);
  if (!slot) return reject(state, "DOMAIN_REJECTED", "Selected character is not in the prepared party.");
  if (!isCoopCompanion(state, memberId) || !state.coopAllowedMemberIds.includes(memberId)) return reject(state, "FORBIDDEN", "Only a currently shared companion may be selected.");
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
    case "set-coop-allowed": {
      if (new Set(intent.memberIds).size !== intent.memberIds.length || intent.memberIds.some(id => !isCoopCompanion(state, id))) {
        return reject(state, "DOMAIN_REJECTED", "Only existing companion member IDs may be shared.");
      }
      const removed = coopRemovedPlayers(state, intent.memberIds);
      if (removed.length && !intent.revokeGuests) return reject(state, "DOMAIN_REJECTED", "Confirm reclaiming control and disconnecting affected guests first.");
      return commit(state, { ...withoutGuests(state, removed), coopAllowedMemberIds: [...intent.memberIds].sort() },
        [{ type: "COOP_ALLOWED_CHANGED", memberIds: [...intent.memberIds] }]);
    }
    case "leave-preparation":
      return commit(state, withoutGuests(state, [playerId]), [{ type: "SEAT_REMOVED", playerId, seat: seatForPlayer(state, playerId)!.seat }]);
    case "proceed-solo": {
      const solo = { ...withoutGuests(state, state.seats.filter(seat => seat.playerId !== state.hostPlayerId).map(seat => seat.playerId)), coopAllowedMemberIds: [] };
      const result = dispatchSessionIntent(solo, playerId, { type: state.lifecycle === "resume-lobby" ? "resume-adventure" : "start-encounter" }, context,
        { connectedPlayerIds: [playerId], effectiveControllerByMemberId: Object.fromEntries(state.partySlots.map(slot => [slot.memberId, playerId])) });
      if (!result.accepted) return reject(state, result.errorCode ?? "DOMAIN_REJECTED", result.error ?? "Solo departure failed.");
      return { ...result, events: [...result.events, { type: "SOLO_PROCEEDED" }] };
    }
    case "create-character": {
      try {
        if (Object.keys(intent).sort().join() !== "creationPresetId,gender,name,type") throw new Error("Only name, gender and preset may be submitted.");
        assertCharacterName(intent.name);
        if (intent.gender !== "male" && intent.gender !== "female") throw new Error("Unsupported Character gender.");
        const preset = context.pack.creationPresets?.[intent.creationPresetId];
        if (!preset || preset.id !== intent.creationPresetId) throw new Error("Unknown creation preset.");
        const actor = assertCreationPreset(preset, context.pack);
        const id = memberIdForPartySlot(1);
        const ready = createAdventureSession(runtime, { members: { [id]: {
          id, seat: 1, actorDefinitionId: actor.id,
          identity: { origin: "player-created", name: intent.name, gender: intent.gender, creationPresetId: preset.id },
          loadout: actor.starterLoadout,
        } } }, state.adventureSeed);
        const started = dispatchAdventureCommand(ready, { type: "start-adventure" }, runtime);
        if (!started.accepted) throw new Error(started.error);
        return commit(state, { ...state, lifecycle: "active", partyPrepared: true,
          partySlots: [{ slot: 1, memberId: id, actorDefinitionId: actor.id }],
          guestClaims: { byMemberId: {} }, coopAllowedMemberIds: [], adventure: started.state }, started.events);
      } catch (error) { return reject(state, "DOMAIN_REJECTED", error instanceof Error ? error.message : String(error)); }
    }
    case "advance-character": {
      const result = dispatchAdventureCommand(state.adventure as AdventureState, intent, runtime);
      if (!result.accepted) return reject(state, "DOMAIN_REJECTED", result.error ?? "Character advancement rejected.");
      return commit(state, { ...state, adventure: result.state }, result.events);
    }
    case "set-party-composition":
      return setPartyComposition(state, intent.actorDefinitionIds, context);
    case "release-character": {
      const entry = Object.entries(state.guestClaims.byMemberId).find(([, claimant]) => claimant === playerId);
      if (!entry) return reject(state, "DOMAIN_REJECTED", "No character is selected.");
      return commit(state, { ...state, guestClaims: { byMemberId: Object.fromEntries(
        Object.entries(state.guestClaims.byMemberId).filter(([, claimant]) => claimant !== playerId),
      ) } }, [{ type: "CHARACTER_RELEASED", playerId, memberId: entry[0] }]);
    }
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
      return commit(state, { ...departureState(state, control), lifecycle: "active", adventure: started.state }, started.events);
    }
    case "resume-adventure":
      // Resume only unlocks the session. Party, Adventure and Combat are untouched, so the
      // gameplay hash is identical and the durable save does not need rewriting.
      return commit(state, { ...departureState(state, control), lifecycle: "active" }, []);
    case "start-encounter": {
      let adventure = state.adventure as AdventureState;
      if (adventure.phase === "ready") {
        const startedAdventure = dispatchAdventureCommand(adventure, { type: "start-adventure" }, runtime);
        if (!startedAdventure.accepted) return reject(state, "DOMAIN_REJECTED", startedAdventure.error ?? "Adventure could not start.");
        adventure = startedAdventure.state;
      }
      const loadout = validatePartyLoadout(adventure.party, adventure.collection, context.pack);
      if (!loadout.valid) return reject(state, "DOMAIN_REJECTED", loadout.issues[0]?.message ?? "Invalid party Loadout.");
      const started = dispatchAdventureCommand(adventure, { type: "start-encounter" }, runtime);
      if (!started.accepted) return reject(state, "DOMAIN_REJECTED", started.error ?? "Adventure rejected encounter start.");
      const range = context.pack.scenarioSources[started.state.currentEncounterId!]?.rules?.partySize;
      const size = Object.keys(started.state.party.members).length;
      if (range && (size < range.min || size > range.max)) return reject(state, "DOMAIN_REJECTED", "This encounter requires its authored party size.");
      try {
        const encounter = buildAdventureEncounter(context.pack, started.state);
        const setup = createCombat(encounter.definition, encounter.seed);
        return commit(state, { ...departureState(state, control), adventure: started.state, combat: setup.state }, [...started.events, ...setup.events]);
      } catch (error) { return reject(state, "DOMAIN_REJECTED", error instanceof Error ? error.message : String(error)); }
    }
    case "choose-reward": {
      const result = dispatchAdventureCommand(state.adventure as AdventureState, {
        type: "choose-reward",
        rewardId: intent.rewardId,
        choiceIndex: intent.choiceIndex,
      }, runtime);
      if (!result.accepted) return reject(state, "DOMAIN_REJECTED", result.error ?? "Adventure rejected reward choice.");
      const partySlots = Object.values(result.state.party.members).sort((a, b) => a.seat - b.seat)
        .map(member => ({ slot: member.seat, memberId: member.id, actorDefinitionId: member.actorDefinitionId }));
      return commit(state, { ...state, adventure: result.state, partySlots }, result.events);
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
    case "complete-scene":
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
  if (state.version !== 5) throw new Error("SessionCoreState must use version 5.");
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
  if (new Set(slots).size !== slots.length || new Set(members).size !== members.length) {
    throw new Error("Party slots and member identities must be unique.");
  }
  for (const [index, slot] of state.partySlots.entries()) {
    if (slot.slot !== index + 1 || slot.memberId !== memberIdForPartySlot(slot.slot)) {
      throw new Error("Party slots must be ordered and use deterministic member IDs.");
    }
  }
  if (!Array.isArray(state.coopAllowedMemberIds) || new Set(state.coopAllowedMemberIds).size !== state.coopAllowedMemberIds.length
    || state.coopAllowedMemberIds.some(id => !isCoopCompanion(state, id))) throw new Error("Invalid live Co-op allowlist.");
  if (state.seats.length - 1 > state.coopAllowedMemberIds.length) throw new Error("Guest admissions exceed shared companion capacity.");
  const claimedPlayers = new Set<string>();
  for (const [memberId, playerId] of Object.entries(state.guestClaims.byMemberId)) {
    const slot = state.partySlots.find((candidate) => candidate.memberId === memberId);
    if (!slot || slot.slot === 1 || !state.coopAllowedMemberIds.includes(memberId)) throw new Error("Guest claims may only target Party Slot 2 or 3.");
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
  if (state.lifecycle !== "lobby" && (!state.partyPrepared || !state.adventure)) {
    throw new Error("Active and restored sessions require a prepared party and AdventureState.");
  }
  if (state.adventure) {
    assertAdventureInvariants(state.adventure);
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
    for (const actor of Object.values(state.combat.actors)) {
      const level = actor.statProfile.stats.level;
      if (actor.statProfile.kind === "creature" && level !== undefined && (!Number.isInteger(level) || level < -1 || level > 25)) throw new Error("Creature level must be -1 through 25.");
    }
    const knowledge = state.combat.knowledge ?? [];
    if (!Array.isArray(knowledge)) throw new Error("Combat knowledge must be a list.");
    const attempts = new Set<string>();
    for (const entry of knowledge) {
      const actor = state.combat.actors[entry.actorId], target = state.combat.actors[entry.targetId];
      const key = JSON.stringify([entry.actorId, entry.targetId]);
      if (!actor || !target || actor.team === target.team || typeof entry.success !== "boolean" || attempts.has(key)) throw new Error("Invalid combat knowledge attempt.");
      attempts.add(key);
    }
    if (state.combat.version !== 6) throw new Error("CombatState must use version 6.");
    for (const [actorId, traits] of Object.entries(state.combat.turn.usedTraitsByActor)) {
      if (!state.combat.actors[actorId] || new Set(traits).size !== traits.length || traits.some(id => !id)) {
        throw new Error("Turn Trait use requires known actors and unique nonempty Trait IDs.");
      }
    }
    if (state.combat.scenarioId !== state.adventure?.currentEncounterId) {
      throw new Error("Combat scenario must match the active Adventure encounter.");
    }
    if (!sameContentIdentity(state.combat.contentIdentity, state.contentIdentity)) {
      throw new Error("Combat content identity must match the Session content identity.");
    }
  }
}
