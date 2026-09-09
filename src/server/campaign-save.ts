import {
  assertAdventureInvariants,
  type AdventureState,
} from "../adventure";
import type { AdventureDefinition } from "../content/content-types";
import { getContentIdentity } from "../content/compile-content";
import type { CombatState, ContentIdentity } from "../game";
import { validatePartyLoadout } from "../loadout";
import {
  assertSessionInvariants,
  createResumedSessionCoreState,
  hashSessionGameplayState,
  memberIdForPartySlot,
  sameContentIdentity,
  type SessionAuthorityContext,
  type SessionCoreState,
  type SessionGameplayProjection,
  type SessionPartySlot,
} from "../session";
import { validateCampaignSaveShape } from "./campaign-save-schema";
import type { CampaignSaveRecord } from "./persistence";

export const CURRENT_SAVE_SCHEMA_VERSION = 1;

/**
 * The durable Campaign payload. It holds gameplay only: no session id, no player id, no
 * guest claim, no reconnect credential, no presence and no request journal. Restoring it
 * therefore cannot resurrect a dead live session's identity.
 */
export interface CampaignSaveV1 {
  readonly saveSchemaVersion: 1;
  readonly contentIdentity: ContentIdentity;
  readonly partySlots: readonly SessionPartySlot[];
  readonly adventure: AdventureState;
  readonly combat: CombatState | null;
}

export type CampaignSaveErrorCode =
  | "SAVE_NOT_FOUND"
  | "SAVE_CORRUPT"
  | "SAVE_SCHEMA_UNSUPPORTED"
  | "SAVE_CONTENT_MISMATCH";

/**
 * A refused save is never repaired, overwritten or deleted: a future build may still know
 * how to migrate it, and silently guessing at its meaning would lose the campaign.
 */
export class CampaignSaveError extends Error {
  public constructor(public readonly code: CampaignSaveErrorCode, message: string) {
    super(message);
    this.name = "CampaignSaveError";
  }
}

function corrupt(message: string): never {
  throw new CampaignSaveError("SAVE_CORRUPT", message);
}

/** Serialize the durable projection of a live session. The input is never mutated. */
export function createCampaignSave(state: SessionCoreState): CampaignSaveV1 {
  const adventure = state.adventure;
  if (!adventure) throw new Error("Campaign save requires an active AdventureState.");
  return {
    saveSchemaVersion: 1,
    contentIdentity: { ...state.contentIdentity },
    partySlots: [...state.partySlots]
      .sort((left, right) => left.slot - right.slot)
      .map((slot) => ({ ...slot })),
    adventure,
    combat: state.combat,
  };
}

/**
 * Schema migration entry point. M9-3 supports v1 only; a future v2 registers its v1 → v2
 * step here rather than letting the validator guess at an unknown shape.
 */
function migrateSaveSchema(version: number, payload: unknown): CampaignSaveV1 {
  if (version !== CURRENT_SAVE_SCHEMA_VERSION) {
    throw new CampaignSaveError(
      "SAVE_SCHEMA_UNSUPPORTED",
      `Save schema version ${String(version)} is not supported by this build.`,
    );
  }
  const shape = validateCampaignSaveShape(payload);
  if (!shape.ok) corrupt("Stored save payload does not match the save schema: " + shape.error);
  return payload as CampaignSaveV1;
}

/**
 * Content migration entry point. No migration is registered in M9-3, so a save written
 * against a different pack is reported rather than reinterpreted.
 */
function migrateSaveContent(save: CampaignSaveV1, current: ContentIdentity): CampaignSaveV1 {
  if (sameContentIdentity(save.contentIdentity, current)) return save;
  throw new CampaignSaveError(
    "SAVE_CONTENT_MISMATCH",
    `Save was written for content pack ${save.contentIdentity.packId}@${save.contentIdentity.packVersion} ` +
      `(${save.contentIdentity.fingerprint}), but this build serves ` +
      `${current.packId}@${current.packVersion} (${current.fingerprint}).`,
  );
}

function adventureDefinition(context: SessionAuthorityContext): AdventureDefinition {
  const definition = context.pack.adventures[context.adventureId];
  if (!definition) throw new Error(`Adventure "${context.adventureId}" is missing.`);
  return definition;
}

function validatePartySlots(save: CampaignSaveV1, context: SessionAuthorityContext): void {
  const slots = [...save.partySlots].sort((left, right) => left.slot - right.slot);
  if (slots.some((slot, index) => slot.slot !== index + 1)) {
    corrupt("Saved party slots must be consecutive and start at slot 1.");
  }
  if (new Set(slots.map((slot) => slot.memberId)).size !== slots.length) {
    corrupt("Saved party member identities must be unique.");
  }
  if (new Set(slots.map((slot) => slot.actorDefinitionId)).size !== slots.length) {
    corrupt("Saved party characters must be unique.");
  }
  for (const slot of slots) {
    if (slot.memberId !== memberIdForPartySlot(slot.slot)) {
      corrupt(`Saved party slot ${String(slot.slot)} does not use its deterministic member id.`);
    }
    const actor = context.pack.actorDefinitions[slot.actorDefinitionId];
    if (!actor) corrupt(`Saved character "${slot.actorDefinitionId}" is not in the current content pack.`);
    if (actor.statProfile.kind !== "character") {
      corrupt(`Saved character "${slot.actorDefinitionId}" is not a Character stat profile.`);
    }
    if (!actor.traits.some((trait) => trait.id === "playable")) {
      corrupt(`Saved character "${slot.actorDefinitionId}" is not playable.`);
    }
  }
}

function validateAdventure(save: CampaignSaveV1, context: SessionAuthorityContext): void {
  const adventure = save.adventure;
  try {
    // Progression shape and Adventure version only; content validity is checked below.
    assertAdventureInvariants(adventure);
  } catch (error) {
    corrupt(error instanceof Error ? error.message : "Saved AdventureState is invalid.");
  }
  const definition = adventureDefinition(context);
  if (adventure.adventureId !== definition.id) {
    corrupt(`Saved adventure "${adventure.adventureId}" is not the adventure this build serves.`);
  }
  const encounterIds = new Set(definition.encounterIds);
  if (adventure.currentEncounterId && !encounterIds.has(adventure.currentEncounterId)) {
    corrupt(`Saved current encounter "${adventure.currentEncounterId}" is unknown.`);
  }
  for (const encounterId of adventure.completedEncounterIds) {
    if (!encounterIds.has(encounterId)) corrupt(`Saved completed encounter "${encounterId}" is unknown.`);
  }
  if (new Set(adventure.completedEncounterIds).size !== adventure.completedEncounterIds.length) {
    corrupt("Saved completed encounters must be unique.");
  }
  if ((adventure.phase === "reward") !== Boolean(adventure.pendingReward)) {
    corrupt("Saved reward phase and pending reward must agree.");
  }
  const pending = adventure.pendingReward;
  if (pending) {
    const reward = definition.rewards.find((candidate) => candidate.id === pending.rewardId);
    if (!reward) corrupt(`Saved pending reward "${pending.rewardId}" is unknown.`);
    if (!encounterIds.has(pending.encounterId)) {
      corrupt(`Saved pending reward encounter "${pending.encounterId}" is unknown.`);
    }
    if (pending.choices.length !== reward.choices.length) {
      corrupt(`Saved pending reward "${pending.rewardId}" does not match the content offer.`);
    }
  }
  const members = Object.values(adventure.party.members);
  const slots = [...save.partySlots].sort((left, right) => left.slot - right.slot);
  const savedMapping = JSON.stringify(slots.map((slot) => [slot.slot, slot.memberId, slot.actorDefinitionId]));
  const adventureMapping = JSON.stringify(
    [...members]
      .sort((left, right) => left.seat - right.seat)
      .map((member) => [member.seat, member.id, member.actorDefinitionId]),
  );
  if (savedMapping !== adventureMapping) {
    corrupt("Saved party slots and the saved Adventure party describe different characters.");
  }
  const loadouts = validatePartyLoadout(adventure.party, adventure.collection, {
    actorDefinitions: context.pack.actorDefinitions,
    combatContent: context.pack.combatContent,
  });
  if (!loadouts.valid) {
    corrupt("Saved party loadout is not legal: " + loadouts.issues.map((issue) => issue.message).join(" "));
  }
  for (const [definitionId] of Object.entries(adventure.collection.equipment)) {
    if (!context.pack.combatContent.equipment[definitionId]) {
      corrupt(`Saved collection equipment "${definitionId}" is unknown.`);
    }
  }
  for (const [definitionId] of Object.entries(adventure.collection.cards)) {
    if (!context.pack.combatContent.cards[definitionId]) {
      corrupt(`Saved collection card "${definitionId}" is unknown.`);
    }
  }
}

function validateCombat(save: CampaignSaveV1, context: SessionAuthorityContext): void {
  const combat = save.combat;
  const adventure = save.adventure;
  if (!combat) {
    if (adventure.phase === "combat") corrupt("Saved combat phase has no CombatState.");
    return;
  }
  if (adventure.phase !== "combat") corrupt("Saved CombatState requires the combat Adventure phase.");
  if (combat.version !== 4) corrupt("Saved CombatState must use version 4.");
  if (!sameContentIdentity(combat.contentIdentity, save.contentIdentity)) {
    corrupt("Saved CombatState content identity does not match the save.");
  }
  if (!context.pack.scenarios[combat.scenarioId]) {
    corrupt(`Saved combat scenario "${combat.scenarioId}" is not in the current content pack.`);
  }
  if (combat.scenarioId !== adventure.currentEncounterId) {
    corrupt("Saved combat scenario does not match the saved Adventure encounter.");
  }

  const actorIds = new Set(Object.keys(combat.actors));
  for (const [actorId, actor] of Object.entries(combat.actors)) {
    if (actor.id !== actorId) corrupt(`Saved actor "${actorId}" does not match its own id.`);
    if (!context.pack.actorDefinitions[actor.definitionId]) {
      corrupt(`Saved actor "${actorId}" references unknown definition "${actor.definitionId}".`);
    }
    if (actor.hp < 0 || actor.hp > actor.maxHp) corrupt(`Saved actor "${actorId}" has HP outside 0..maxHp.`);
    if (actor.defeated !== (actor.hp <= 0)) corrupt(`Saved actor "${actorId}" defeat flag disagrees with its HP.`);
    if (
      actor.position.x >= combat.map.width ||
      actor.position.y >= combat.map.height
    ) corrupt(`Saved actor "${actorId}" stands outside the map.`);
  }
  const heroMembers = new Set(Object.keys(adventure.party.members));
  for (const memberId of heroMembers) {
    if (!actorIds.has(memberId)) corrupt(`Saved combat is missing party member "${memberId}".`);
  }
  if (combat.turn.initiativeOrder.length !== actorIds.size) {
    corrupt("Saved initiative order must cover every actor exactly once.");
  }
  if (new Set(combat.turn.initiativeOrder).size !== combat.turn.initiativeOrder.length) {
    corrupt("Saved initiative order must not repeat an actor.");
  }
  for (const actorId of combat.turn.initiativeOrder) {
    if (!actorIds.has(actorId)) corrupt(`Saved initiative order references unknown actor "${actorId}".`);
  }
  if (combat.turn.initiativeOrder[combat.turn.activeIndex] !== combat.turn.activeActorId) {
    corrupt("Saved active actor does not match the active initiative index.");
  }
  for (const [actorId, zones] of Object.entries(combat.cardZones)) {
    if (!actorIds.has(actorId)) corrupt(`Saved card zones reference unknown actor "${actorId}".`);
    const instanceIds = [...zones.drawPile, ...zones.hand, ...zones.discardPile].map((card) => card.id);
    if (new Set(instanceIds).size !== instanceIds.length) {
      corrupt(`Saved card instances for "${actorId}" are not unique.`);
    }
    for (const card of [...zones.drawPile, ...zones.hand, ...zones.discardPile]) {
      if (!context.pack.combatContent.cards[card.definitionId]) {
        corrupt(`Saved card "${card.definitionId}" is not in the current content pack.`);
      }
    }
  }
  for (const [effectId, effect] of Object.entries(combat.effects)) {
    if (effect.id !== effectId) corrupt(`Saved effect "${effectId}" does not match its own id.`);
    if (!actorIds.has(effect.targetActorId)) {
      corrupt(`Saved effect "${effectId}" targets unknown actor "${effect.targetActorId}".`);
    }
  }
  // Tiles are keyed by position, objects by their own id, and an interaction names a
  // content tile id — three different keys that a hand-edited row would blur together.
  const tileIds = new Set<string>();
  for (const [tileKey, tile] of Object.entries(combat.map.tiles)) {
    if (tileKey !== `${String(tile.position.x)},${String(tile.position.y)}`) {
      corrupt(`Saved tile "${tileKey}" is not stored under its own position.`);
    }
    if (tile.position.x >= combat.map.width || tile.position.y >= combat.map.height) {
      corrupt(`Saved tile "${tileKey}" lies outside the map.`);
    }
    tileIds.add(tile.id);
  }
  for (const [objectId, object] of Object.entries(combat.map.objects)) {
    if (object.id !== objectId) corrupt(`Saved map object "${objectId}" does not match its own id.`);
    if (!tileIds.has(object.interaction.targetTileId)) {
      corrupt(`Saved map object "${objectId}" targets unknown tile "${object.interaction.targetTileId}".`);
    }
  }
  const pending = combat.pendingReaction;
  if (pending) {
    if (!actorIds.has(pending.sourceActorId)) {
      corrupt(`Saved pending reaction references unknown actor "${pending.sourceActorId}".`);
    }
    if (!pending.candidates.length) corrupt("Saved pending reaction has no candidate.");
    for (const candidate of pending.candidates) {
      if (!actorIds.has(candidate.actorId)) {
        corrupt(`Saved reaction candidate references unknown actor "${candidate.actorId}".`);
      }
      const hand = combat.cardZones[candidate.actorId]?.hand ?? [];
      if (!hand.some((card) => card.id === candidate.cardInstanceId)) {
        corrupt(`Saved reaction candidate card "${candidate.cardInstanceId}" is not in that actor's hand.`);
      }
      if (!context.pack.combatContent.actions[candidate.actionId]) {
        corrupt(`Saved reaction candidate action "${candidate.actionId}" is unknown.`);
      }
    }
    if (!actorIds.has(pending.continuation.actorId)) {
      corrupt("Saved reaction continuation references an unknown actor.");
    }
  }
  const sequences = combat.commandLog.map((command) => command.sequence);
  if (sequences.some((sequence, index) => sequence !== index + 1)) {
    corrupt("Saved command log must be a gap-free sequence starting at 1.");
  }
  if (combat.sequence !== combat.commandLog.length) {
    corrupt("Saved combat sequence must match the command log length.");
  }
}

/**
 * Turn a stored row into a validated gameplay projection, or throw a `CampaignSaveError`
 * naming exactly why the save cannot be resumed. Nothing here recomputes gameplay: no
 * encounter is rebuilt and no command is replayed, so validation cannot alter the save.
 */
export function restoreCampaignSave(
  record: CampaignSaveRecord,
  context: SessionAuthorityContext,
): SessionGameplayProjection {
  if (!record.snapshotHash) corrupt("Stored save has no snapshot hash.");
  if (!Number.isInteger(record.saveSchemaVersion)) corrupt("Stored save schema version is not an integer.");

  let parsed: unknown;
  try {
    parsed = JSON.parse(record.snapshotJson) as unknown;
  } catch {
    corrupt("Stored save payload is not valid JSON.");
  }

  // The stored metadata is what a stale writer or a hand-edited row would disagree with.
  const declaredVersion = (parsed as { readonly saveSchemaVersion?: unknown })?.saveSchemaVersion;
  if (declaredVersion !== record.saveSchemaVersion) {
    corrupt("Stored save schema version does not match its payload.");
  }
  const candidate = migrateSaveSchema(record.saveSchemaVersion, parsed);

  if (!sameContentIdentity(candidate.contentIdentity, record.contentIdentity)) {
    corrupt("Stored content identity does not match its payload.");
  }
  const save = migrateSaveContent(candidate, getContentIdentity(context.pack));

  validatePartySlots(save, context);
  validateAdventure(save, context);
  validateCombat(save, context);

  const projection: SessionGameplayProjection = {
    contentIdentity: save.contentIdentity,
    partySlots: [...save.partySlots].sort((left, right) => left.slot - right.slot),
    adventure: save.adventure,
    combat: save.combat,
  };
  // The rehydrated session must satisfy every live invariant before any writer is retired.
  try {
    assertSessionInvariants(createResumedSessionCoreState(
      { sessionId: "save-validation", playerId: "save-validation-host", displayName: "Host" },
      projection,
      context,
    ));
  } catch (error) {
    corrupt(error instanceof Error ? error.message : "Saved gameplay cannot form a valid session.");
  }
  if (hashSessionGameplayState(projection) !== record.snapshotHash) {
    corrupt("Stored snapshot hash does not match the stored gameplay payload.");
  }
  return projection;
}
