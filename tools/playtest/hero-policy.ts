import { gridDistance } from "../../src/game/grid";
import { listLegalActions, listLegalTargets, previewAction } from "../../src/game/queries";
import { facingToward } from "../../src/game/rules";
import type {
  ActionDefinition,
  ActionOutcomeEffect,
  ActionPreview,
  ActionSource,
  ActionTarget,
  ActorState,
  CombatCommand,
  CombatContent,
  CombatState,
  DegreeOfSuccess,
  LegalAction,
  LegalTarget,
} from "../../src/game/types";

/**
 * A deterministic hero policy for the #21 playtest harness.
 *
 * `chooseAiCommand` only speaks for the enemy team, by design — the heroes are the player.
 * An automated playtest still needs someone to hold the party's turn, so this file plays it,
 * and it lives in `tools/` because it is measurement apparatus, not game code: nothing under
 * `src/` imports it and it adds no rules. Every choice is read out of production queries
 * (`listLegalActions`, `listLegalTargets`, `previewAction`), so what it can do is exactly
 * what a player could do through the same interface.
 *
 * It is a greedy one-action-at-a-time policy, in this order:
 *
 *   1. stand up or escape a grab, because everything else is worth less while stuck
 *   2. heal the most wounded party member once someone is under 60% HP
 *   3. put up a defence it is carrying — cover, a ward, a parry — once it is below half HP
 *   4. pull a lever it is standing next to — an Encounter that gates its enemies behind one
 *      cannot be finished any other way, so this comes before looking for a target
 *   5. the highest-scoring Action aimed at an enemy, scored per action point
 *   6. raise a shield when nothing offensive is worth doing
 *   7. close on the nearest enemy, the same way the creature AI closes, and on the nearest
 *      unused interactable when no enemy can be closed on
 *   8. end the turn
 *
 * The scores come from `previewAction` where it reports one (a Strike's hit chance and
 * damage range) and from the authored outcome effects where it does not (a save-based Action
 * lands on the target's failure). This is a reasonable player, not an optimal one, and the
 * report says so: *usage* frequencies are a property of this policy, while what was ever
 * *legal* is a property of the content.
 */

/** A Condition landing on an enemy is worth roughly this much damage, for ranking only. */
const CONTROL_VALUE = 4;
const HEAL_THRESHOLD = 0.6;
const DEFEND_THRESHOLD = 0.5;
const RECOVERY_ACTION_IDS = ["stand", "escape-grab"] as const;
const SHIELD_ACTION_ID = "raise-shield";
const INTERACT_ACTION_ID = "interact-lever";
const BASIC_STRIDE_ID = "stride";

function commandId(state: CombatState, label: string): string {
  return `hero-${String(state.sequence + 1).padStart(4, "0")}-${label}`;
}

function useActionCommand(
  state: CombatState,
  actorId: string,
  source: ActionSource,
  target: ActionTarget,
): CombatCommand {
  return {
    type: "use-action",
    id: commandId(state, source.id),
    sequence: state.sequence + 1,
    actorId,
    action: source,
    target,
  };
}

function outcomeEffects(definition: ActionDefinition, degrees: readonly DegreeOfSuccess[]): readonly ActionOutcomeEffect[] {
  const resolution = definition.resolution;
  if (resolution.kind === "move") return [];
  if (resolution.kind === "direct") return resolution.effects;
  return degrees.flatMap((degree) => resolution.outcomes[degree]);
}

function averageDice(dice: { readonly count: number; readonly sides: number }, flat: number, multiplier = 1): number {
  return ((dice.count * (dice.sides + 1)) / 2 + flat) * multiplier;
}

function healingValue(definition: ActionDefinition): number {
  return outcomeEffects(definition, ["critical-success", "success"])
    .filter((effect) => effect.kind === "restore-hp")
    .reduce((total, effect) => total + averageDice(effect.dice, effect.flatModifier, effect.multiplier ?? 1), 0);
}

function actorTargets(targets: readonly LegalTarget[]): readonly Extract<LegalTarget, { kind: "actor" }>[] {
  return targets.filter((target): target is Extract<LegalTarget, { kind: "actor" }> => target.kind === "actor");
}

/** Effects the acting side wants, weighted by how often the roll lets them through. */
function effectValue(definition: ActionDefinition, preview: ActionPreview): number {
  const probabilities = preview.degreeProbabilities;
  const resolution = definition.resolution;
  if (resolution.kind === "move") return 0;
  if (resolution.kind === "direct" || !probabilities) {
    return outcomeEffects(definition, ["success"]).reduce(
      (total, effect) => total + hostileEffectValue(effect),
      0,
    );
  }
  // A Strike or an actor-rolled check pays out when the actor succeeds; a target's save pays
  // out when the target fails. The preview always reports the roller's own probabilities.
  const rollerIsTarget = resolution.kind !== "strike" && resolution.check.roller === "target";
  const paying: readonly DegreeOfSuccess[] = rollerIsTarget
    ? ["failure", "critical-failure"]
    : ["success", "critical-success"];
  return paying.reduce((total, degree) => {
    const chance = probabilities[degree];
    const effects = outcomeEffects(definition, [degree]);
    return total + chance * effects.reduce((sum, effect) => sum + hostileEffectValue(effect), 0);
  }, 0);
}

function hostileEffectValue(effect: ActionOutcomeEffect): number {
  if (effect.kind === "damage" && effect.owner === "target") {
    return averageDice(effect.dice, effect.flatModifier, effect.multiplier ?? 1);
  }
  if (effect.kind === "apply-condition" && effect.owner === "target") return CONTROL_VALUE * (effect.value ?? 1);
  if (effect.kind === "lock-action") return CONTROL_VALUE / 2;
  return 0;
}

function offensiveScore(definition: ActionDefinition, preview: ActionPreview): number {
  if (!preview.legal) return 0;
  const strikeDamage = preview.damageRange
    ? ((preview.damageRange[0] + preview.damageRange[1]) / 2) *
      ((preview.hitChance ?? 0) + (preview.criticalChance ?? 0))
    : 0;
  // A two-action Action is charged 1.5 actions, not 2. What it displaces is not a second
  // fresh Strike but a MAP-penalised one, and charging full price buries every authored
  // two-action Card under a plain Strike — which is a property of the scorer, not of the Card.
  const actions = definition.timing.kind === "turn" ? definition.timing.actions : 1;
  const cost = actions > 1 ? actions - 0.5 : 1;
  return (strikeDamage + effectValue(definition, preview)) / cost;
}

function enabled(actions: readonly LegalAction[], kind: ActionSource["kind"], actionId: string): LegalAction | undefined {
  return actions.find((action) => action.enabled && action.source.kind === kind && action.actionId === actionId);
}

function woundedAlly(state: CombatState, actor: ActorState, targets: readonly LegalTarget[]): string | undefined {
  return actorTargets(targets)
    .flatMap((target) => {
      const candidate = state.actors[target.actorId];
      if (!candidate || candidate.defeated || candidate.team !== actor.team) return [];
      if (candidate.hp >= candidate.maxHp * HEAL_THRESHOLD) return [];
      return [{ actorId: target.actorId, ratio: candidate.hp / candidate.maxHp }];
    })
    .sort((left, right) => left.ratio - right.ratio || left.actorId.localeCompare(right.actorId))
    .map((entry) => entry.actorId)[0];
}

/** Which prepared, granted and innate Actions the hero could legally have taken this turn. */
export function legalHeroActions(state: CombatState, content: CombatContent): readonly LegalAction[] {
  const actor = state.actors[state.turn.activeActorId];
  if (!actor || actor.team !== "heroes") return [];
  return listLegalActions(state, actor.id, content).filter((action) => action.enabled);
}

export function chooseHeroCommand(state: CombatState, content: CombatContent): CombatCommand | null {
  if (state.outcome || state.pendingReaction) return null;
  const actor = state.actors[state.turn.activeActorId];
  if (!actor || actor.team !== "heroes" || actor.defeated) return null;
  const actions = listLegalActions(state, actor.id, content);

  for (const actionId of RECOVERY_ACTION_IDS) {
    const action = enabled(actions, "context", actionId);
    if (action) return useActionCommand(state, actor.id, action.source, { kind: "none" });
  }

  const healers = actions
    .filter((action) => {
      const definition = action.enabled ? content.actions[action.actionId] : undefined;
      return definition !== undefined && healingValue(definition) > 0;
    })
    .sort((left, right) => left.actionId.localeCompare(right.actionId));
  for (const action of healers) {
    const targets = listLegalTargets(state, actor.id, action.source, content);
    const target = woundedAlly(state, actor, targets);
    if (target) return useActionCommand(state, actor.id, action.source, { kind: "actor", actorId: target });
  }

  // A defensive Card is only ever worth an action when the hero is actually being hit, so the
  // policy holds them until half HP. Without this the authored defences never appear at all
  // and the playtest would report them dead when they are only unused.
  if (actor.hp < actor.maxHp * DEFEND_THRESHOLD) {
    const defence = actions
      .filter((action) => {
        const definition = action.enabled ? content.actions[action.actionId] : undefined;
        if (!definition || definition.targeting !== "self") return false;
        const applied = outcomeEffects(definition, ["critical-success", "success"]).filter(
          (effect) => effect.kind === "apply-condition" && effect.owner === "actor",
        );
        return applied.length > 0 && applied.every(
          (effect) => effect.kind === "apply-condition" && !actor.conditions.some((held) => held.id === effect.condition),
        );
      })
      .sort((left, right) => left.actionId.localeCompare(right.actionId))[0];
    if (defence) return useActionCommand(state, actor.id, defence.source, { kind: "none" });
  }

  const interact = enabled(actions, "context", INTERACT_ACTION_ID);
  if (interact) {
    const object = listLegalTargets(state, actor.id, interact.source, content)
      .filter((target): target is Extract<LegalTarget, { kind: "object" }> => target.kind === "object")
      .sort((left, right) => left.objectId.localeCompare(right.objectId))[0];
    if (object) {
      return useActionCommand(state, actor.id, interact.source, { kind: "object", objectId: object.objectId });
    }
  }

  let best: { readonly command: CombatCommand; readonly score: number; readonly key: string } | null = null;
  for (const action of actions) {
    if (!action.enabled) continue;
    const definition = content.actions[action.actionId];
    if (!definition || definition.timing.kind !== "turn") continue;
    for (const target of actorTargets(listLegalTargets(state, actor.id, action.source, content))) {
      const candidate = state.actors[target.actorId];
      if (!candidate || candidate.defeated || candidate.team === actor.team) continue;
      const intent: ActionTarget = { kind: "actor", actorId: target.actorId };
      const score = offensiveScore(definition, previewAction(state, actor.id, action.source, intent, content));
      if (score <= 0) continue;
      // Ties resolve by action id and then target id, so the same seed replays the same run.
      const key = `${action.actionId}:${target.actorId}`;
      if (best && (score < best.score || (score === best.score && key >= best.key))) continue;
      best = { command: useActionCommand(state, actor.id, action.source, intent), score, key };
    }
  }
  // A shield is worth more than a third Strike at -10, which is how a PF2e turn is usually
  // spent: attack while the penalty is small, then raise. The policy asks for it on the last
  // action of the turn, or when there was nothing to attack at all.
  const shield = enabled(actions, "context", SHIELD_ACTION_ID);
  const nearestEnemy = Object.values(state.actors)
    .filter((candidate) => candidate.team !== actor.team && !candidate.defeated)
    .sort((left, right) => gridDistance(left.position, actor.position) - gridDistance(right.position, actor.position))[0];
  const threatened = nearestEnemy !== undefined && gridDistance(nearestEnemy.position, actor.position) <= 30;
  if (shield && !actor.shieldRaised && threatened && (state.turn.actionsRemaining === 1 || !best)) {
    return useActionCommand(state, actor.id, shield.source, { kind: "none" });
  }
  if (best) return best.command;

  const stride = enabled(actions, "basic", BASIC_STRIDE_ID);
  const enemy = Object.values(state.actors)
    .filter((candidate) => candidate.team !== actor.team && !candidate.defeated)
    .sort(
      (left, right) =>
        gridDistance(left.position, actor.position) - gridDistance(right.position, actor.position) ||
        left.id.localeCompare(right.id),
    )[0];
  const lever = Object.values(state.map.objects)
    .filter((object) => !object.used)
    .sort(
      (left, right) =>
        gridDistance(left.position, actor.position) - gridDistance(right.position, actor.position) ||
        left.id.localeCompare(right.id),
    )[0];
  for (const goal of [enemy?.position, lever?.position]) {
    if (!stride || !goal) continue;
    const destination = listLegalTargets(state, actor.id, stride.source, content)
      .filter((candidate): candidate is Extract<LegalTarget, { kind: "tile" }> => candidate.kind === "tile")
      .sort(
        (left, right) =>
          gridDistance(left.position, goal) - gridDistance(right.position, goal) ||
          left.costFeet - right.costFeet ||
          left.position.y - right.position.y ||
          left.position.x - right.position.x,
      )[0];
    if (destination && gridDistance(destination.position, goal) < gridDistance(actor.position, goal)) {
      return useActionCommand(state, actor.id, stride.source, {
        kind: "tile",
        position: destination.position,
        facing: facingToward(destination.position, goal),
      });
    }
  }

  // The basic Strike is already in the scored pool, so reaching here means the hero had
  // nothing legal worth an action: no reachable enemy, no step that closes, nothing to raise.
  return { type: "end-turn", id: commandId(state, "end-turn"), sequence: state.sequence + 1, actorId: actor.id };
}

/** The reaction queue only ever offers its head candidate, so the policy answers for that one. */
export function chooseReactionCommand(state: CombatState): CombatCommand | null {
  const pending = state.pendingReaction;
  if (!pending) return null;
  const candidate = pending.candidates[0];
  if (!candidate) return null;
  const reactor = state.actors[candidate.actorId];
  const base = { id: commandId(state, "reaction"), sequence: state.sequence + 1, triggerId: pending.triggerId };
  if (!reactor || reactor.team !== "heroes") {
    return { type: "pass-reaction", actorId: candidate.actorId, ...base };
  }
  return {
    type: "use-reaction",
    actorId: candidate.actorId,
    cardInstanceId: candidate.cardInstanceId,
    ...base,
  };
}
