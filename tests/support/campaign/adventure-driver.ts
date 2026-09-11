import {
  gridDistance,
  listLegalActions,
  listLegalTargets,
  type ActionSource,
  type ActionTarget,
  type CombatState,
  type LegalTarget,
} from "../../../src/game";
import { PRODUCTION_CONTENT } from "../../../src/content";
import type { AdventureState } from "../../../src/adventure";
import type { RewardGrant } from "../../../src/content";
import { deriveLoadoutSnapshot } from "../../../src/loadout";
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
function actorTargets(targets: readonly LegalTarget[]): readonly Extract<LegalTarget, { kind: "actor" }>[] {
  return targets.filter((target): target is Extract<LegalTarget, { kind: "actor" }> => target.kind === "actor");
}

/** Whether an Action heals, read off its authored effects rather than an id list. */
function restoresHp(actionId: string): boolean {
  const resolution = CONTENT.actions[actionId]?.resolution;
  if (!resolution || resolution.kind === "move") return false;
  const effects = resolution.kind === "direct" ? resolution.effects : Object.values(resolution.outcomes).flat();
  return effects.some((effect) => effect.kind === "restore-hp");
}

/**
 * A deterministic hero policy built only from the shared legality queries, so it can only
 * ask for what a player could ask for.
 */
export function heroIntent(combat: CombatState, actorId: string): SessionIntent {
  const actor = combat.actors[actorId];
  if (!actor) throw new Error("Missing active hero.");
  const actions = listLegalActions(combat, actorId, CONTENT).filter((entry) => entry.enabled);
  const use = (source: ActionSource, target: ActionTarget): SessionIntent =>
    ({ type: "use-action", action: source, target });

  for (const actionId of ["stand", "escape-grab"]) {
    const entry = actions.find((candidate) => candidate.source.kind === "context" && candidate.actionId === actionId);
    if (entry) return use(entry.source, { kind: "none" });
  }
  const interact = actions.find((candidate) => candidate.actionId === "interact-lever");
  if (interact) {
    const target = listLegalTargets(combat, actorId, interact.source, CONTENT)
      .find((candidate): candidate is Extract<LegalTarget, { kind: "object" }> => candidate.kind === "object");
    if (target) return use(interact.source, { kind: "object", objectId: target.objectId });
  }
  // Patch up a badly hurt ally before swinging, or the healers on the far side of the
  // adventure simply out-attrit a party that only attacks.
  const hurt = Object.values(combat.actors)
    .filter((candidate) => candidate.team === actor.team && !candidate.defeated && candidate.hp * 2 <= candidate.maxHp);
  if (hurt.length > 0) {
    for (const candidate of actions.filter((entry) => restoresHp(entry.actionId))) {
      const target = actorTargets(listLegalTargets(combat, actorId, candidate.source, CONTENT))
        .filter((entry) => hurt.some((ally) => ally.id === entry.actorId))
        .sort((left, right) => (combat.actors[left.actorId]?.hp ?? 0) - (combat.actors[right.actorId]?.hp ?? 0))[0];
      if (target) return use(candidate.source, { kind: "actor", actorId: target.actorId });
    }
  }
  // Cheapest offence first, so a turn buys the most attacks it can, aimed at whoever is
  // closest to dropping. Spreading damage loses to anything that heals.
  const offensive = actions
    .filter((candidate) => CONTENT.actions[candidate.actionId]?.targeting === "enemy" && candidate.timing.kind === "turn")
    .map((candidate) => ({
      entry: candidate,
      target: [...actorTargets(listLegalTargets(combat, actorId, candidate.source, CONTENT))]
        .sort((left, right) =>
          (combat.actors[left.actorId]?.hp ?? 0) - (combat.actors[right.actorId]?.hp ?? 0) ||
          left.actorId.localeCompare(right.actorId))[0],
      cost: candidate.timing.kind === "turn" ? candidate.timing.actions : 9,
    }))
    .filter((candidate) => candidate.target)
    .sort((left, right) => left.cost - right.cost || left.entry.actionId.localeCompare(right.entry.actionId));
  const best = offensive[0];
  if (best?.target) return use(best.entry.source, { kind: "actor", actorId: best.target.actorId });

  const shield = actions.find((candidate) => candidate.actionId === "raise-shield");
  if (shield && !actor.shieldRaised) return use(shield.source, { kind: "none" });

  const stride = actions.find((candidate) => candidate.source.kind === "basic" && candidate.actionId === "stride");
  const enemy = Object.values(combat.actors)
    .filter((candidate) => candidate.team === "enemies" && !candidate.defeated)
    .sort((left, right) => left.id.localeCompare(right.id))[0];
  if (stride && enemy) {
    const destination = listLegalTargets(combat, actorId, stride.source, CONTENT)
      .filter((candidate): candidate is Extract<LegalTarget, { kind: "tile" }> => candidate.kind === "tile")
      .sort((left, right) =>
        gridDistance(left.position, enemy.position) - gridDistance(right.position, enemy.position) ||
        left.costFeet - right.costFeet ||
        left.position.y - right.position.y ||
        left.position.x - right.position.x)[0];
    if (destination && gridDistance(destination.position, enemy.position) < gridDistance(actor.position, enemy.position)) {
      return { type: "use-action", action: stride.source, target: { kind: "tile", position: destination.position } };
    }
  }
  return { type: "end-turn", facing: actor.facing };
}

/**
 * Wears a just-granted item, as the Loadout screen would: on whoever has the slot free,
 * otherwise on whoever it does not make worse. "Worse" is read off the production resolver,
 * so this driver never invents its own arithmetic. Card rewards are left alone — preparing
 * one is a capacity decision this driver has no policy for.
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
  const empty = members.find((member) => !member.loadout.equipment[equipment.slot]);
  if (empty) return wear(empty);
  for (const member of members) {
    const definition = PRODUCTION_CONTENT.pack.actorDefinitions[member.actorDefinitionId];
    if (!definition) continue;
    const intent = wear(member) as Extract<SessionIntent, { type: "set-loadout" }>;
    // Judged against the Level the party actually carries, not the authored Level 1.
    const effective = resolveEffectiveCharacterStatProfile(definition, member.progression);
    const before = deriveLoadoutSnapshot(definition, member.loadout, CONTENT, member.id, effective);
    const after = deriveLoadoutSnapshot(definition, intent.loadout, CONTENT, member.id, effective);
    const damage = (snapshot: typeof before): number =>
      snapshot.strike.damage.count * (snapshot.strike.damage.sides + 1) / 2 + snapshot.strike.damage.flatModifier;
    if (after.statistics.ac >= before.statistics.ac && damage(after) >= damage(before)) return intent;
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
