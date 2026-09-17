import { chooseAdvancement } from "../../../tools/playtest/advancement-policy";
import { chooseHeroCommand } from "../../../tools/playtest/hero-policy";
import type { CombatState } from "../../../src/game";
import { PRODUCTION_CONTENT } from "../../../src/content";
import type { AdventureState } from "../../../src/adventure";
import type { RewardGrant } from "../../../src/content";
import { deriveLoadoutSnapshot, previewLoadoutChange } from "../../../src/loadout";
import { resolveEffectiveCharacterStatProfile } from "../../../src/adventure/progression";
import type { SessionIntent } from "../../../src/session";

const CONTENT = PRODUCTION_CONTENT.pack.combatContent;

/**
 * The shared way a test plays the production Adventure.
 *
 * Every durability suite needs a party that can actually reach the fourth victory, and a
 * private policy per suite is how one of them quietly stops reaching it. The policy asks
 * only through the shared legality queries, so it can never request something a player
 * could not.
 */
/** Whether an Action heals, read off its authored effects rather than an id list. */
function restoresHp(actionId: string): boolean {
  const resolution = CONTENT.actions[actionId]?.resolution;
  if (!resolution || resolution.kind === "move") return false;
  const effects = resolution.kind === "direct" ? resolution.effects : Object.values(resolution.outcomes).flat();
  return effects.some((effect) => effect.kind === "restore-hp");
}

/**
 * Use the same preview-based tactical policy as the production playtest harness,
 * translating its legal combat command into the session's transport intent.
 */
export function heroIntent(combat: CombatState, actorId: string): SessionIntent {
  if (combat.turn.activeActorId !== actorId) throw new Error("Expected the active hero.");
  const command = chooseHeroCommand(combat, CONTENT);
  if (command?.type === "use-action") return { type: "use-action", action: command.action, target: command.target };
  if (command?.type === "end-turn") return { type: "end-turn", facing: command.facing };
  throw new Error("The shared playtest policy returned no hero intent.");
}

/**
 * Wears a just-granted item, as the Loadout screen would: on whoever has the slot free,
 * otherwise on whoever it does not make worse. "Worse" is read off the production resolver,
 * so this driver never invents its own arithmetic. Healing Card rewards use the
 * separate preparation policy below.
 */
export function equipIntent(adventure: AdventureState | null, grant: RewardGrant): SessionIntent | null {
  if (!adventure || grant.kind !== "equipment") return null;
  const equipment = CONTENT.equipment[grant.definitionId];
  if (!equipment) return null;
  const members = Object.values(adventure.party.members).sort((left, right) => left.id.localeCompare(right.id));
  const wear = (member: (typeof members)[number]): SessionIntent => ({
    type: "set-loadout",
    memberId: member.id,
    loadout: { ...member.loadout, equipment: { ...member.loadout.equipment, [equipment.slot]: equipment.id } },
  });
  const legal = (member: (typeof members)[number]): boolean => {
    const intent = wear(member) as Extract<SessionIntent, { type: "set-loadout" }>;
    return previewLoadoutChange(adventure.party, adventure.collection, PRODUCTION_CONTENT.pack, member.id, intent.loadout).legal;
  };
  const empty = members.find((member) => !member.loadout.equipment[equipment.slot] && legal(member));
  if (empty) return wear(empty);
  for (const member of members) {
    if (!legal(member)) continue;
    const definition = PRODUCTION_CONTENT.pack.actorDefinitions[member.actorDefinitionId];
    if (!definition) continue;
    const intent = wear(member) as Extract<SessionIntent, { type: "set-loadout" }>;
    // Judged against the Level the party actually carries, not the authored Level 1.
    const effective = resolveEffectiveCharacterStatProfile(definition, member.progression, PRODUCTION_CONTENT.pack.characterRules);
    const before = deriveLoadoutSnapshot(definition, member.loadout, CONTENT, member.id, effective);
    const after = deriveLoadoutSnapshot(definition, intent.loadout, CONTENT, member.id, effective);
    const damage = (snapshot: typeof before): number =>
      snapshot.strike.damage.count * (snapshot.strike.damage.sides + 1) / 2 + snapshot.strike.damage.flatModifier;
    if (after.statistics.ac >= before.statistics.ac && damage(after) >= damage(before)) return intent;
  }
  return null;
}

function prepareCardIntent(adventure: AdventureState, cardId: string, collection = adventure.collection): SessionIntent | null {
  for (const member of Object.values(adventure.party.members).sort((a, b) => a.id.localeCompare(b.id))) {
    if (member.loadout.preparedCards.includes(cardId)) continue;
    const loadout = { ...member.loadout, preparedCards: [...member.loadout.preparedCards, cardId] };
    if (previewLoadoutChange(adventure.party, collection, PRODUCTION_CONTENT.pack, member.id, loadout).legal) {
      return { type: "set-loadout", memberId: member.id, loadout };
    }
  }
  return null;
}

/** Acquire healing the party can legally prepare, including Class-specific reward Cards. */
export function rewardChoiceIndex(adventure: AdventureState): number {
  const choices = adventure.pendingReward?.choices ?? [];
  const index = choices.findIndex(choice => {
    if (choice.kind !== "card" || !restoresHp(CONTENT.cards[choice.definitionId]!.actionId)) return false;
    const collection = { ...adventure.collection, cards: { ...adventure.collection.cards,
      [choice.definitionId]: (adventure.collection.cards[choice.definitionId] ?? 0) + 1,
    } };
    return prepareCardIntent(adventure, choice.definitionId, collection) !== null;
  });
  return index < 0 ? 0 : index;
}

/** Use the real loadout boundary and its ownership, capacity, and Class checks. */
export function prepareHealingIntent(adventure: AdventureState): SessionIntent | null {
  for (const cardId of Object.keys(adventure.collection.cards).sort()) {
    if (!restoresHp(CONTENT.cards[cardId]!.actionId)) continue;
    const intent = prepareCardIntent(adventure, cardId);
    if (intent) return intent;
  }
  return null;
}

/** A hero reaction is a human boundary: the server waits, so the client must answer it. */
export function reactionIntent(combat: CombatState): SessionIntent | null {
  const pending = combat.pendingReaction;
  if (!pending) return null;
  const candidate = pending.candidates[0];
  if (!candidate) return { type: "pass-reaction", triggerId: pending.triggerId };
  if (combat.actors[candidate.actorId]?.team !== "heroes") return null;
  return { type: "use-reaction", triggerId: pending.triggerId, cardInstanceId: candidate.cardInstanceId };
}

/** One explicit growth choice; callers send it before entering the next battle. */
export function advancementIntent(adventure: AdventureState | null): SessionIntent | null {
  if (!adventure || (adventure.phase !== "ready" && adventure.phase !== "between-encounters")) return null;
  for (const member of Object.values(adventure.party.members).sort((a, b) => a.seat - b.seat)) {
    const choice = chooseAdvancement(member, PRODUCTION_CONTENT.pack);
    if (choice) return { type: "advance-character", memberId: member.id, choice };
  }
  return null;
}
