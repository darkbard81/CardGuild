import { gridDistance } from "./grid";
import { listLegalActions, listLegalTargets } from "./queries";
import { facingToward } from "./rules";
import type {
  ActionDefinition,
  ActionOutcomeEffect,
  ActionSource,
  ActorState,
  CombatCommand,
  CombatContent,
  CombatState,
  LegalAction,
  LegalTarget,
} from "./types";

/**
 * The only Action ids the AI names. These are universal basic and context actions that
 * every Actor can reach, not production content: Stand and Escape exist to undo a state an
 * Actor is stuck in, and Strike/Stride are the fallbacks any Actor falls back to. Production
 * innate actions are never listed here — a new creature ability must work by being authored,
 * not by being added to this file.
 */
const RECOVERY_ACTION_IDS = ["stand", "escape-grab"] as const;
const BASIC_STRIKE_ID = "strike";
const BASIC_STRIDE_ID = "stride";

function commandId(state: CombatState, label: string): string {
  return `ai-${String(state.sequence + 1).padStart(4, "0")}-${label}`;
}

function useActionCommand(
  state: CombatState,
  actorId: string,
  source: ActionSource,
  target: Extract<CombatCommand, { type: "use-action" }>["target"],
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

/** Every effect an Action can apply, whatever resolution carries it. */
function actionEffects(definition: ActionDefinition): readonly ActionOutcomeEffect[] {
  const resolution = definition.resolution;
  if (resolution.kind === "move") return [];
  if (resolution.kind === "direct") return resolution.effects;
  return Object.values(resolution.outcomes).flat();
}

/**
 * Whether an Action is one the AI knows how to aim at a friend. The test is the effect
 * shape, not an id list, so any authored healing Action is picked up without touching this
 * file. An `ally`/`creature` Action that only buffs is deliberately left alone: choosing
 * between buffs needs a utility model this milestone does not have.
 */
function restoresHp(definition: ActionDefinition): boolean {
  return actionEffects(definition).some((effect) => effect.kind === "restore-hp");
}

function actorTargets(targets: readonly LegalTarget[]): readonly Extract<LegalTarget, { kind: "actor" }>[] {
  return targets.filter((target): target is Extract<LegalTarget, { kind: "actor" }> => target.kind === "actor");
}

/**
 * The most hurt teammate, by missing-HP fraction and then by id so the pick never depends on
 * object order. `creature` targeting reaches everyone, which is why the team check happens
 * here rather than being left to the target query: healing an enemy is legal, not useful.
 */
function woundedAllyTarget(
  state: CombatState,
  actor: ActorState,
  targets: readonly LegalTarget[],
): Extract<LegalTarget, { kind: "actor" }> | undefined {
  return actorTargets(targets)
    .flatMap((target) => {
      const candidate = state.actors[target.actorId];
      if (!candidate || candidate.defeated) return [];
      if (candidate.team !== actor.team) return [];
      if (candidate.hp >= candidate.maxHp) return [];
      return [{ target, ratio: candidate.hp / candidate.maxHp }];
    })
    .sort((left, right) => left.ratio - right.ratio || left.target.actorId.localeCompare(right.target.actorId))
    .map((entry) => entry.target)[0];
}

/**
 * Turns one legal innate Action into a command, or nothing when the AI has no policy for
 * aiming it. Targeting drives the choice, so control, damage and healing all arrive here
 * through the same path; no branch here is keyed on the resolution kind. (`restoresHp()`
 * reads it only to know where a resolution keeps its effects.)
 */
function innateCommand(
  state: CombatState,
  actor: ActorState,
  action: LegalAction,
  definition: ActionDefinition,
  content: CombatContent,
): CombatCommand | null {
  const targets = listLegalTargets(state, actor.id, action.source, content);
  if (definition.targeting === "self" || definition.targeting === "none") {
    return targets.some((target) => target.kind === "none")
      ? useActionCommand(state, actor.id, action.source, { kind: "none" })
      : null;
  }
  if (definition.targeting === "enemy") {
    const target = actorTargets(targets)[0];
    return target ? useActionCommand(state, actor.id, action.source, { kind: "actor", actorId: target.actorId }) : null;
  }
  if (definition.targeting === "ally" || definition.targeting === "creature") {
    if (!restoresHp(definition)) return null;
    const target = woundedAllyTarget(state, actor, targets);
    return target ? useActionCommand(state, actor.id, action.source, { kind: "actor", actorId: target.actorId }) : null;
  }
  // Tile, object and effect targeting need a spatial or lifecycle policy of their own.
  return null;
}

function enabled(actions: readonly LegalAction[], kind: ActionSource["kind"], actionId: string): LegalAction | undefined {
  return actions.find((action) => action.enabled && action.source.kind === kind && action.actionId === actionId);
}

export function chooseAiCommand(state: CombatState, content: CombatContent): CombatCommand | null {
  if (state.outcome || state.pendingReaction) return null;
  const actor = state.actors[state.turn.activeActorId];
  if (!actor || actor.team !== "enemies") return null;

  const actions = listLegalActions(state, actor.id, content);

  // 1. Undo a state the Actor is stuck in before spending the turn on anything else.
  for (const actionId of RECOVERY_ACTION_IDS) {
    const action = enabled(actions, "context", actionId);
    if (action) return useActionCommand(state, actor.id, action.source, { kind: "none" });
  }

  // 2. Authored innate actions, in the order the creature declares them. That order is the
  //    creature's whole AI preference — there is no separate priority schema.
  for (const actionId of actor.innateActionIds) {
    const action = enabled(actions, "innate", actionId);
    if (!action) continue;
    const definition = content.actions[actionId];
    if (!definition) continue;
    const command = innateCommand(state, actor, action, definition, content);
    if (command) return command;
  }

  // 3. The basic Strike, which a Fixed Strike's own range already decides the reach of.
  const strike = enabled(actions, "basic", BASIC_STRIKE_ID);
  if (strike) {
    const target = actorTargets(listLegalTargets(state, actor.id, strike.source, content))[0];
    if (target) return useActionCommand(state, actor.id, strike.source, { kind: "actor", actorId: target.actorId });
  }

  // 4. Close on the first surviving hero, but only if the step actually shortens the gap.
  const stride = enabled(actions, "basic", BASIC_STRIDE_ID);
  const hero = Object.values(state.actors)
    .filter((candidate) => candidate.team === "heroes" && !candidate.defeated)
    .sort((left, right) => left.id.localeCompare(right.id))[0];
  if (stride && hero) {
    const destination = listLegalTargets(state, actor.id, stride.source, content)
      .filter((candidate): candidate is Extract<LegalTarget, { kind: "tile" }> => candidate.kind === "tile")
      .sort(
        (left, right) =>
          gridDistance(left.position, hero.position) - gridDistance(right.position, hero.position) ||
          left.costFeet - right.costFeet ||
          left.position.y - right.position.y ||
          left.position.x - right.position.x,
      )[0];
    if (destination && gridDistance(destination.position, hero.position) < gridDistance(actor.position, hero.position)) {
      return useActionCommand(state, actor.id, stride.source, {
        kind: "tile",
        position: destination.position,
        facing: facingToward(destination.position, hero.position),
      });
    }
  }

  return {
    type: "end-turn",
    id: commandId(state, "end-turn"),
    sequence: state.sequence + 1,
    actorId: actor.id,
  };
}
