import { actionRangeFeet, buildResolvedActionPlan, turnMapContext } from "./action-plan";
import { degreeProbabilities } from "./checks";
import {
  canStepOnto,
  findReachableTiles,
  getTile,
  gridDistance,
  hasLineOfEffect,
  hasLineOfSight,
  positionKey,
} from "./grid";
import { strikeDamageTotal } from "./offense";
import {
  getConditionActionGrants,
  getEquipmentActionGrants,
  isInFrontOrSide,
} from "./rules";
import type {
  ActionDefinition,
  ActionPreview,
  ActionSource,
  ActionTarget,
  ActionValidationResult,
  ActorState,
  CardInstance,
  CombatContent,
  CombatState,
  ContextActionOption,
  LegalAction,
  LegalTarget,
} from "./types";

const BASIC_ACTION_IDS = ["step", "stride", "strike"] as const;

export interface ResolvedAction {
  readonly definition: ActionDefinition;
  readonly card?: CardInstance;
  readonly sourceLabel?: string;
}

function hasCondition(actor: ActorState, condition: "prone" | "grabbed"): boolean {
  return actor.conditions.some((entry) => entry.id === condition);
}

export function getContextActionOptions(
  state: CombatState,
  actor: ActorState,
  content: CombatContent,
): readonly ContextActionOption[] {
  const options: ContextActionOption[] = [];
  for (const grant of getConditionActionGrants(actor, content)) {
    options.push({ source: { kind: "context", id: grant.actionId }, group: grant.contextGroup });
  }

  const hasAdjacentObject = Object.values(state.map.objects).some(
    (object) => !object.used && gridDistance(actor.position, object.position) === 5,
  );
  if (hasAdjacentObject) {
    options.push({ source: { kind: "context", id: "interact-lever" }, group: "interact" });
  }

  for (const grant of getEquipmentActionGrants(actor, content)) {
    options.push({ source: { kind: "context", id: grant.actionId }, group: grant.contextGroup });
  }

  const hasSustainedEffect = Object.values(state.effects).some(
    (effect) => effect.targetActorId === actor.id && effect.traits.some((trait) => trait.id === "sustained"),
  );
  if (hasSustainedEffect) {
    options.push({ source: { kind: "context", id: "sustain-spell" }, group: "sustain" });
  }

  const unique = new Map(options.map((option) => [option.source.id, option]));
  return [...unique.values()];
}

function getCardFromHand(state: CombatState, actorId: string, cardId: string): CardInstance | undefined {
  return state.cardZones[actorId]?.hand.find((card) => card.id === cardId);
}

export function resolveActionSource(
  state: CombatState,
  actor: ActorState,
  source: ActionSource,
  content: CombatContent,
): ResolvedAction | null {
  if (source.kind === "card") {
    const card = getCardFromHand(state, actor.id, source.id);
    if (!card) return null;
    const cardDefinition = content.cards[card.definitionId];
    if (!cardDefinition) return null;
    const definition = content.actions[cardDefinition.actionId];
    if (!definition) return null;
    const sourceLabel = card.source.kind === "equipment-trait"
      ? content.equipment[card.source.equipmentId]?.name ?? card.source.equipmentId
      : card.source.kind === "prepared"
        ? "Prepared Card"
        : card.source.sourceId;
    return {
      definition,
      card,
      sourceLabel,
    };
  }

  const definition = content.actions[source.id];
  if (!definition) return null;
  if (source.kind === "basic" && !BASIC_ACTION_IDS.includes(source.id as (typeof BASIC_ACTION_IDS)[number])) {
    return null;
  }
  if (
    source.kind === "context" &&
    !getContextActionOptions(state, actor, content).some((candidate) => candidate.source.id === source.id)
  ) {
    return null;
  }
  if (source.kind === "innate" && !actor.innateActionIds.includes(source.id)) return null;
  return { definition };
}

function movementTargets(
  state: CombatState,
  actor: ActorState,
  definition: ActionDefinition,
): readonly LegalTarget[] {
  if (definition.resolution.kind !== "move") return [];
  const moveEffect = definition.resolution;
  if (hasCondition(actor, "prone")) return [];
  if (hasCondition(actor, "grabbed")) return [];

  const maximumCost = moveEffect.step ? 5 : actor.speedFeet;
  const reachable = findReachableTiles(
    state.map,
    state.actors,
    actor.id,
    actor.position,
    maximumCost,
    moveEffect.movementMode,
  );

  return [...reachable.values()]
    .filter((node) => {
      if (!moveEffect.step) return true;
      const tile = getTile(state.map, node.position);
      return node.path.length === 1 && Boolean(tile && canStepOnto(tile, moveEffect.movementMode));
    })
    .sort((left, right) => left.cost - right.cost || left.position.y - right.position.y || left.position.x - right.position.x)
    .map((node) => ({ kind: "tile" as const, position: node.position, costFeet: node.cost }));
}

function enemyTargets(
  state: CombatState,
  actor: ActorState,
  definition: ActionDefinition,
  content: CombatContent,
): readonly LegalTarget[] {
  const range = actionRangeFeet(definition, actor, { content });

  return Object.values(state.actors)
    .filter(
      (target) =>
        !target.defeated &&
        target.team !== actor.team &&
        gridDistance(actor.position, target.position) <= range &&
        isInFrontOrSide(actor, target.position) &&
        hasLineOfSight(state.map, actor.position, target.position) &&
        hasLineOfEffect(state.map, actor.position, target.position),
    )
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((target) => ({ kind: "actor" as const, actorId: target.id, label: target.name }));
}

/**
 * Support targeting. Range and line of effect still apply, but the front/side facing
 * restriction does not: facing gates who an Actor can attack, not who it can reach to heal
 * or buff. `creature` includes the acting Actor itself, `ally` excludes it.
 */
function actorScopeTargets(
  state: CombatState,
  actor: ActorState,
  definition: ActionDefinition,
  content: CombatContent,
  scope: "ally" | "creature",
): readonly LegalTarget[] {
  const range = actionRangeFeet(definition, actor, { content });
  return Object.values(state.actors)
    .filter((candidate) => {
      if (candidate.defeated) return false;
      if (candidate.id === actor.id) return scope === "creature";
      if (scope === "ally" && candidate.team !== actor.team) return false;
      return (
        gridDistance(actor.position, candidate.position) <= range &&
        hasLineOfSight(state.map, actor.position, candidate.position) &&
        hasLineOfEffect(state.map, actor.position, candidate.position)
      );
    })
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((candidate) => ({ kind: "actor" as const, actorId: candidate.id, label: candidate.name }));
}

function listCandidateTargets(
  state: CombatState,
  actor: ActorState,
  definition: ActionDefinition,
  content: CombatContent,
): readonly LegalTarget[] {
  if (definition.resolution.kind === "move") return movementTargets(state, actor, definition);
  if (definition.targeting === "enemy") return enemyTargets(state, actor, definition, content);
  if (definition.targeting === "ally" || definition.targeting === "creature") {
    return actorScopeTargets(state, actor, definition, content, definition.targeting);
  }
  if (definition.targeting === "object") {
    return Object.values(state.map.objects)
      .filter((object) => !object.used && gridDistance(actor.position, object.position) === 5)
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((object) => ({ kind: "object" as const, objectId: object.id, label: object.name }));
  }
  if (definition.targeting === "effect") {
    return Object.values(state.effects)
      .filter((effect) => effect.targetActorId === actor.id && effect.traits.some((trait) => trait.id === "sustained"))
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((effect) => ({ kind: "effect" as const, effectId: effect.id, label: effect.name }));
  }
  return [{ kind: "none" }];
}

export function targetIsLegal(targets: readonly LegalTarget[], target: ActionTarget): boolean {
  return targets.some((candidate) => {
    if (candidate.kind !== target.kind) return false;
    if (candidate.kind === "none" && target.kind === "none") return true;
    if (candidate.kind === "actor" && target.kind === "actor") return candidate.actorId === target.actorId;
    if (candidate.kind === "tile" && target.kind === "tile") return positionKey(candidate.position) === positionKey(target.position);
    if (candidate.kind === "object" && target.kind === "object") return candidate.objectId === target.objectId;
    if (candidate.kind === "effect" && target.kind === "effect") return candidate.effectId === target.effectId;
    return false;
  });
}

interface BaseActionValidation extends ActionValidationResult {
  readonly actor?: ActorState;
  readonly resolved?: ResolvedAction;
}

const ACTION_CANNOT_RESOLVE = "Action cannot be resolved.";

function buildIntentPlan(
  state: CombatState,
  actor: ActorState,
  resolved: ResolvedAction,
  source: ActionSource,
  target: ActionTarget,
  content: CombatContent,
) {
  return buildResolvedActionPlan(
    resolved.definition,
    actor,
    target,
    source,
    state,
    content,
    turnMapContext(state),
  );
}

function validateActionBase(
  state: CombatState,
  actorId: string,
  source: ActionSource,
  content: CombatContent,
): BaseActionValidation {
  const actor = state.actors[actorId];
  if (!actor) return { legal: false, reason: "Unknown actor." };
  if (actor.defeated) return { legal: false, reason: "Actor cannot act." };
  if (state.outcome) return { legal: false, reason: "Combat has ended." };
  if (state.pendingReaction) return { legal: false, reason: "A reaction decision is pending." };
  if (state.turn.activeActorId !== actor.id) return { legal: false, reason: "Not this actor's turn." };
  const resolved = resolveActionSource(state, actor, source, content);
  if (!resolved) return { legal: false, reason: "Action source is unavailable." };
  const definition = resolved.definition;
  if (definition.timing.kind === "reaction") {
    return { legal: false, reason: "Requires a reaction trigger.", actor, resolved };
  }
  if (definition.timing.actions > state.turn.actionsRemaining) {
    return { legal: false, reason: "Not enough actions remaining.", actor, resolved };
  }
  if (state.turn.lockedActionIds.includes(definition.id)) {
    return { legal: false, reason: `${definition.name} is locked until the next turn.`, actor, resolved };
  }
  if (source.kind === "context" && source.id === "raise-shield" && actor.shieldRaised) {
    return { legal: false, reason: "Shield is already raised.", actor, resolved };
  }
  return { legal: true, actor, resolved };
}

export function validateActionIntent(
  state: CombatState,
  actorId: string,
  source: ActionSource,
  target: ActionTarget,
  content: CombatContent,
): ActionValidationResult {
  const base = validateActionBase(state, actorId, source, content);
  if (!base.legal || !base.actor || !base.resolved) return { legal: false, reason: base.reason };
  const targets = listCandidateTargets(state, base.actor, base.resolved.definition, content);
  if (targets.length === 0) return { legal: false, reason: "No legal target." };
  if (!targetIsLegal(targets, target)) return { legal: false, reason: "Target is not legal." };
  if (!buildIntentPlan(state, base.actor, base.resolved, source, target, content)) {
    return { legal: false, reason: ACTION_CANNOT_RESOLVE };
  }
  return { legal: true };
}

function targetIntent(target: LegalTarget, actor: ActorState): ActionTarget {
  switch (target.kind) {
    case "none":
      return { kind: "none" };
    case "actor":
      return { kind: "actor", actorId: target.actorId };
    case "tile":
      return { kind: "tile", position: target.position, facing: actor.facing };
    case "object":
      return { kind: "object", objectId: target.objectId };
    case "effect":
      return { kind: "effect", effectId: target.effectId };
  }
}

export function listLegalTargets(
  state: CombatState,
  actorId: string,
  source: ActionSource,
  content: CombatContent,
): readonly LegalTarget[] {
  const base = validateActionBase(state, actorId, source, content);
  const { actor, resolved } = base;
  if (!base.legal || !actor || !resolved) return [];
  return listCandidateTargets(state, actor, resolved.definition, content).filter((candidate) =>
    buildIntentPlan(state, actor, resolved, source, targetIntent(candidate, actor), content),
  );
}

export function listLegalActions(
  state: CombatState,
  actorId: string,
  content: CombatContent,
): readonly LegalAction[] {
  const actor = state.actors[actorId];
  if (!actor) return [];
  const contextOptions = getContextActionOptions(state, actor, content);
  const sources: ActionSource[] = [
    ...BASIC_ACTION_IDS.map((id) => ({ kind: "basic" as const, id })),
    ...contextOptions.map((option) => option.source),
    ...actor.innateActionIds.map((id) => ({ kind: "innate" as const, id })),
    ...(state.cardZones[actor.id]?.hand.map((card) => ({ kind: "card" as const, id: card.id })) ?? []),
  ];

  return sources.flatMap((source) => {
    const resolved = resolveActionSource(state, actor, source, content);
    if (!resolved) return [];
    const base = validateActionBase(state, actor.id, source, content);
    let validation: ActionValidationResult;
    if (!base.legal) {
      validation = { legal: false, reason: base.reason };
    } else {
      const candidates = listCandidateTargets(state, actor, resolved.definition, content);
      if (candidates.length === 0) {
        validation = { legal: false, reason: "No legal target." };
      } else {
        validation = candidates.some((candidate) =>
          buildIntentPlan(state, actor, resolved, source, targetIntent(candidate, actor), content),
        )
          ? { legal: true }
          : { legal: false, reason: ACTION_CANNOT_RESOLVE };
      }
    }
    return [
      {
        source,
        actionId: resolved.definition.id,
        name: resolved.definition.name,
        description: resolved.definition.description,
        timing: resolved.definition.timing,
        traits: resolved.definition.traits.map((trait) => trait.id),
        enabled: validation.legal,
        reason: validation.reason,
        sourceLabel: resolved.sourceLabel,
        contextGroup: contextOptions.find((option) => option.source.id === source.id)?.group,
      },
    ];
  });
}

export function previewAction(
  state: CombatState,
  actorId: string,
  source: ActionSource,
  target: ActionTarget,
  content: CombatContent,
): ActionPreview {
  const actor = state.actors[actorId];
  if (!actor) return { legal: false, reason: "Unknown actor.", notes: [] };
  const validation = validateActionIntent(state, actorId, source, target, content);
  if (!validation.legal) return { legal: false, reason: validation.reason, notes: [] };
  const resolved = resolveActionSource(state, actor, source, content);
  if (!resolved) return { legal: false, reason: "Unknown action source.", notes: [] };

  // Every resolution, movement included, goes through the plan; only path legality stays
  // in the movement resolver, which owns reachability and cost.
  const plan = buildIntentPlan(state, actor, resolved, source, target, content);
  if (!plan) return { legal: false, reason: ACTION_CANNOT_RESOLVE, notes: [] };
  const resolution = plan.resolution;

  if (resolution.kind === "move") {
    const reached = target.kind === "tile"
      ? listCandidateTargets(state, actor, resolved.definition, content).find(
          (candidate) => candidate.kind === "tile" && positionKey(candidate.position) === positionKey(target.position),
        )
      : undefined;
    return {
      legal: true,
      pathCostFeet: reached?.kind === "tile" ? reached.costFeet : undefined,
      notes: plan.notes,
    };
  }
  if (resolution.kind === "direct") {
    return { legal: true, notes: plan.notes };
  }

  const check = resolution.check;
  // Probabilities are always the roller's. Only a Strike has actor-side hit semantics, so
  // a target's save is never reported as the acting Character's hit or critical chance.
  const probabilities = degreeProbabilities(check.modifier, check.dc);
  const checkPreview = {
    legal: true,
    check: { roller: check.roller, rollerActorId: check.rollerActorId, modifier: check.modifier, dc: check.dc },
    degreeProbabilities: probabilities,
    notes: plan.notes,
  };
  if (resolution.kind === "check") return checkPreview;

  const strike = resolution.strike;
  return {
    ...checkPreview,
    hitChance: probabilities.success + probabilities["critical-success"],
    criticalChance: probabilities["critical-success"],
    damageRange: [
      // Both ends run the execution helper, so the minimum-1 rule cannot drift.
      strikeDamageTotal(strike.damage.count, strike.damage.flatModifier, resolution.damageMultiplier),
      strikeDamageTotal(strike.damage.count * strike.damage.sides, strike.damage.flatModifier, resolution.damageMultiplier),
    ],
  };
}
