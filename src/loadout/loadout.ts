import type { ActorDefinition, EncounterActorPlacement } from "../content/content-types";
import {
  getEquipmentActionGrants,
  getEquipmentCardGrants,
  getStatistic,
  getWeaponProfile,
} from "../game/rules";
import type {
  ActorSetup,
  ActorState,
  CombatContent,
  DeckContribution,
  DeckContributionSource,
  EquipmentId,
} from "../game/types";
import {
  EQUIPMENT_SLOT_ORDER,
  type DerivedDeck,
  type DerivedLoadoutSnapshot,
  type LoadoutCollection,
  type LoadoutContent,
  type LoadoutParty,
  type LoadoutPreview,
  type LoadoutValidationIssue,
  type LoadoutValidationResult,
  type PartyMemberLoadout,
} from "./types";

function cloneLoadout(loadout: PartyMemberLoadout): PartyMemberLoadout {
  return {
    equipment: { ...loadout.equipment },
    preparedCards: [...loadout.preparedCards],
  };
}

export function clonePartyLoadout(loadout: PartyMemberLoadout): PartyMemberLoadout {
  return cloneLoadout(loadout);
}

export function equipmentIds(loadout: PartyMemberLoadout): readonly EquipmentId[] {
  return EQUIPMENT_SLOT_ORDER.flatMap((slot) => {
    const id = loadout.equipment[slot];
    return id ? [id] : [];
  });
}

function increment(target: Record<string, number>, id: string, amount = 1): void {
  target[id] = (target[id] ?? 0) + amount;
}

export function createStartingCollection(
  party: LoadoutParty,
  content: LoadoutContent,
): LoadoutCollection {
  const equipment: Record<string, number> = {};
  const cards: Record<string, number> = {};
  for (const member of Object.values(party.members).sort((left, right) => left.id.localeCompare(right.id))) {
    const definition = content.actorDefinitions[member.actorDefinitionId];
    if (!definition) throw new Error(`Actor definition "${member.actorDefinitionId}" is missing.`);
    for (const id of equipmentIds(definition.starterLoadout)) increment(equipment, id);
    for (const id of definition.starterLoadout.preparedCards) increment(cards, id);
  }
  return { equipment, cards };
}

export function validatePartyLoadout(
  party: LoadoutParty,
  collection: LoadoutCollection,
  content: LoadoutContent,
): LoadoutValidationResult {
  const issues: LoadoutValidationIssue[] = [];
  const usedEquipment: Record<string, number> = {};
  const usedCards: Record<string, number> = {};

  for (const member of Object.values(party.members).sort((left, right) => left.id.localeCompare(right.id))) {
    const actor = content.actorDefinitions[member.actorDefinitionId];
    if (!actor) {
      issues.push({ code: "UNKNOWN_ACTOR", memberId: member.id, definitionId: member.actorDefinitionId, message: `Actor definition "${member.actorDefinitionId}" is missing.` });
      continue;
    }
    for (const slot of EQUIPMENT_SLOT_ORDER) {
      const id = member.loadout.equipment[slot];
      if (!id) continue;
      const equipment = content.combatContent.equipment[id];
      if (!equipment) {
        issues.push({ code: "UNKNOWN_EQUIPMENT", memberId: member.id, definitionId: id, slot, message: `Equipment "${id}" is missing.` });
        continue;
      }
      if (equipment.slot !== slot) {
        issues.push({ code: "SLOT_MISMATCH", memberId: member.id, definitionId: id, slot, message: `${equipment.name} belongs in the ${equipment.slot} slot, not ${slot}.` });
        continue;
      }
      increment(usedEquipment, id);
    }
    if (member.loadout.preparedCards.length > actor.loadoutProfile.preparedCardCapacity) {
      issues.push({
        code: "PREPARED_CAPACITY_EXCEEDED",
        memberId: member.id,
        message: `${actor.name} can prepare ${actor.loadoutProfile.preparedCardCapacity} cards, but ${member.loadout.preparedCards.length} were selected.`,
      });
    }
    for (const id of member.loadout.preparedCards) {
      if (!content.combatContent.cards[id]) {
        issues.push({ code: "UNKNOWN_CARD", memberId: member.id, definitionId: id, message: `Card "${id}" is missing.` });
        continue;
      }
      increment(usedCards, id);
    }
  }

  for (const [id, used] of Object.entries(usedEquipment).sort(([left], [right]) => left.localeCompare(right))) {
    const owned = collection.equipment[id] ?? 0;
    if (used > owned) {
      issues.push({ code: "EQUIPMENT_COPIES_EXCEEDED", definitionId: id, message: `${used} copies of ${content.combatContent.equipment[id]?.name ?? id} are equipped, but only ${owned} are owned.` });
    }
  }
  for (const [id, used] of Object.entries(usedCards).sort(([left], [right]) => left.localeCompare(right))) {
    const owned = collection.cards[id] ?? 0;
    if (used > owned) {
      issues.push({ code: "CARD_COPIES_EXCEEDED", definitionId: id, message: `${used} copies of ${content.combatContent.cards[id]?.name ?? id} are prepared, but only ${owned} are owned.` });
    }
  }
  return { valid: issues.length === 0, issues };
}

function sameSource(left: DeckContributionSource, right: DeckContributionSource): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "base" && right.kind === "base") return left.sourceId === right.sourceId;
  if (left.kind === "prepared" && right.kind === "prepared") return left.memberId === right.memberId;
  return left.kind === "equipment-trait" && right.kind === "equipment-trait" &&
    left.equipmentId === right.equipmentId && left.traitId === right.traitId;
}

function addContribution(target: DeckContribution[], next: DeckContribution): void {
  const existingIndex = target.findIndex((entry) => entry.cardDefinitionId === next.cardDefinitionId && sameSource(entry.source, next.source));
  if (existingIndex < 0) {
    target.push(next);
    return;
  }
  const existing = target[existingIndex];
  if (existing) target[existingIndex] = { ...existing, count: existing.count + next.count };
}

function sourceKey(source: DeckContributionSource): string {
  if (source.kind === "base") return `base:${source.sourceId}`;
  if (source.kind === "prepared") return `prepared:${source.memberId}`;
  return `equipment:${source.equipmentId}:${source.traitId}`;
}

function compareContribution(left: DeckContribution, right: DeckContribution): number {
  return left.cardDefinitionId.localeCompare(right.cardDefinitionId) ||
    sourceKey(left.source).localeCompare(sourceKey(right.source));
}

export function deriveTacticalDeck(
  actor: ActorDefinition,
  loadout: PartyMemberLoadout,
  content: CombatContent,
  memberId: string,
): DerivedDeck {
  const contributions: DeckContribution[] = [];
  for (const grant of actor.baseCardGrants) {
    addContribution(contributions, {
      cardDefinitionId: grant.cardDefinitionId,
      count: grant.count,
      source: { kind: "base", sourceId: grant.sourceId },
    });
  }
  for (const cardDefinitionId of loadout.preparedCards) {
    addContribution(contributions, {
      cardDefinitionId,
      count: 1,
      source: { kind: "prepared", memberId },
    });
  }
  for (const grant of getEquipmentCardGrants({ equipmentIds: equipmentIds(loadout) }, content)) {
    if (!grant.traitId) continue;
    addContribution(contributions, {
      cardDefinitionId: grant.cardDefinitionId,
      count: grant.count,
      source: { kind: "equipment-trait", equipmentId: grant.sourceId, traitId: grant.traitId },
    });
  }
  return {
    contributions: contributions.sort(compareContribution),
    totalCards: contributions.reduce((total, contribution) => total + contribution.count, 0),
  };
}

export function deriveActorSetup(
  actor: ActorDefinition,
  placement: EncounterActorPlacement,
  loadout: PartyMemberLoadout,
  content: CombatContent,
  memberId = placement.instanceId,
): ActorSetup {
  const deck = deriveTacticalDeck(actor, loadout, content, memberId);
  return {
    id: placement.instanceId,
    definitionId: actor.id,
    name: actor.name,
    team: placement.team,
    position: { ...placement.position },
    facing: placement.facing,
    hp: actor.hp,
    maxHp: actor.maxHp,
    baseAc: actor.baseAc,
    reflexModifier: actor.reflexModifier,
    athleticsModifier: actor.athleticsModifier,
    initiativeModifier: actor.initiativeModifier,
    speedFeet: actor.speedFeet,
    fallbackWeapon: { ...actor.fallbackWeapon, damage: { ...actor.fallbackWeapon.damage } },
    conditions: (actor.initialConditions ?? []).map((condition) => ({ ...condition })),
    traits: actor.traits.map((trait) => ({ ...trait, params: trait.params ? { ...trait.params } : undefined })),
    equipmentIds: [...equipmentIds(loadout)],
    innateActionIds: [...actor.innateActionIds],
    deckContributions: deck.contributions.map((contribution) => ({ ...contribution, source: { ...contribution.source } })),
  };
}

function actorForRules(actor: ActorDefinition, loadout: PartyMemberLoadout, content: CombatContent): ActorState {
  const setup = deriveActorSetup(actor, {
    instanceId: actor.id,
    actorDefinitionId: actor.id,
    team: "heroes",
    position: { x: 0, y: 0 },
    facing: "north",
  }, loadout, content, actor.id);
  return { ...setup, reactionAvailable: false, shieldRaised: false, defeated: false };
}

export function deriveLoadoutSnapshot(
  actor: ActorDefinition,
  loadout: PartyMemberLoadout,
  content: CombatContent,
  memberId: string,
): DerivedLoadoutSnapshot {
  const ruleActor = actorForRules(actor, loadout, content);
  const contextActionIds = [...new Set(getEquipmentActionGrants(ruleActor, content).map((grant) => grant.actionId))].sort();
  return {
    equipmentIds: [...ruleActor.equipmentIds],
    deck: deriveTacticalDeck(actor, loadout, content, memberId),
    statistics: {
      ac: getStatistic(ruleActor, content, "ac").value,
      reflex: getStatistic(ruleActor, content, "reflex").value,
    },
    weapon: { ...getWeaponProfile(ruleActor, content), damage: { ...getWeaponProfile(ruleActor, content).damage } },
    contextActionIds,
  };
}

function contributionKey(contribution: DeckContribution): string {
  return `${contribution.cardDefinitionId}|${sourceKey(contribution.source)}`;
}

function contributionDiff(
  left: readonly DeckContribution[],
  right: readonly DeckContribution[],
): readonly DeckContribution[] {
  const rightCounts = new Map(right.map((entry) => [contributionKey(entry), entry.count]));
  return left.flatMap((entry) => {
    const count = entry.count - (rightCounts.get(contributionKey(entry)) ?? 0);
    return count > 0 ? [{ ...entry, count, source: { ...entry.source } }] : [];
  });
}

export function previewLoadoutChange(
  party: LoadoutParty,
  collection: LoadoutCollection,
  content: LoadoutContent,
  memberId: string,
  candidate: PartyMemberLoadout,
): LoadoutPreview {
  const member = party.members[memberId];
  if (!member) throw new Error(`Party member "${memberId}" is missing.`);
  const actor = content.actorDefinitions[member.actorDefinitionId];
  if (!actor) throw new Error(`Actor definition "${member.actorDefinitionId}" is missing.`);
  const nextParty: LoadoutParty = {
    members: { ...party.members, [memberId]: { ...member, loadout: cloneLoadout(candidate) } },
  };
  const validation = validatePartyLoadout(nextParty, collection, content);
  const before = deriveLoadoutSnapshot(actor, member.loadout, content.combatContent, memberId);
  const after = validation.valid ? deriveLoadoutSnapshot(actor, candidate, content.combatContent, memberId) : null;
  return {
    legal: validation.valid,
    validation,
    before,
    after,
    addedCards: after ? contributionDiff(after.deck.contributions, before.deck.contributions) : [],
    removedCards: after ? contributionDiff(before.deck.contributions, after.deck.contributions) : [],
    addedContextActionIds: after ? after.contextActionIds.filter((id) => !before.contextActionIds.includes(id)) : [],
    removedContextActionIds: after ? before.contextActionIds.filter((id) => !after.contextActionIds.includes(id)) : [],
  };
}
