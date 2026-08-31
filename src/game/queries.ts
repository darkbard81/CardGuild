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
import {
  getConditionActionGrants,
  getEquipmentActionGrants,
  getStatistic,
  getWeaponProfile,
  isDirectlyBehind,
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
  if (definition.effect.kind !== "move") return [];
  const moveEffect = definition.effect;
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
  const weapon = getWeaponProfile(actor, content);
  const range = definition.effect.kind === "trip" || definition.effect.kind === "weapon-attack" ? weapon.rangeFeet : 5;

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

function listCandidateTargets(
  state: CombatState,
  actor: ActorState,
  definition: ActionDefinition,
  content: CombatContent,
): readonly LegalTarget[] {
  if (definition.effect.kind === "move") return movementTargets(state, actor, definition);
  if (definition.targeting === "enemy") return enemyTargets(state, actor, definition, content);
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
  if (!base.legal || !base.actor || !base.resolved) return [];
  return listCandidateTargets(state, base.actor, base.resolved.definition, content);
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
    const candidate = listCandidateTargets(state, actor, resolved.definition, content)[0];
    const validation = validateActionIntent(
      state,
      actor.id,
      source,
      candidate ? targetIntent(candidate, actor) : { kind: "none" },
      content,
    );
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

function mapPenalty(state: CombatState, definition: ActionDefinition): number {
  if (!definition.traits.some((trait) => trait.id === "attack")) return 0;
  const stage = Math.min(2, state.turn.attacksThisTurn);
  return [0, -5, -10][stage] as number;
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
  const legalTargets = listCandidateTargets(state, actor, resolved.definition, content);

  if (target.kind === "tile") {
    const legal = legalTargets.find(
      (candidate) => candidate.kind === "tile" && positionKey(candidate.position) === positionKey(target.position),
    );
    return {
      legal: true,
      pathCostFeet: legal?.kind === "tile" ? legal.costFeet : undefined,
      notes: [`Face ${target.facing} after moving.`],
    };
  }

  if (target.kind === "actor") {
    const targetActor = state.actors[target.actorId];
    if (!targetActor) return { legal: false, reason: "Unknown target.", notes: [] };
    const penalty = mapPenalty(state, resolved.definition);
    const isTrip = resolved.definition.effect.kind === "trip";
    const modifier = (isTrip ? actor.athleticsModifier : getWeaponProfile(actor, content).attackModifier) + penalty;
    const statistic = isTrip ? getStatistic(targetActor, content, "reflex") : getStatistic(targetActor, content, "ac");
    const rearBonus = !isTrip && isDirectlyBehind(actor.position, targetActor) ? -2 : 0;
    const dc = statistic.value + rearBonus;
    const probabilities = degreeProbabilities(modifier, dc);
    const damage = getWeaponProfile(actor, content).damage;
    return {
      legal: true,
      hitChance: probabilities.success + probabilities["critical-success"],
      criticalChance: probabilities["critical-success"],
      damageRange:
        resolved.definition.effect.kind === "weapon-attack"
          ? [
              (damage.count + damage.modifier) * resolved.definition.effect.damageMultiplier,
              (damage.count * damage.sides + damage.modifier) * resolved.definition.effect.damageMultiplier,
            ]
          : undefined,
      notes: [
        `MAP ${penalty}`,
        ...(rearBonus ? ["Rear attack: target AC -2"] : []),
        ...statistic.sources,
      ],
    };
  }

  return { legal: true, notes: [] };
}
