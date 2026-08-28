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
  getEquipment,
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
  ActorState,
  CardInstance,
  CombatContent,
  CombatState,
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

export function getContextActionSources(
  state: CombatState,
  actor: ActorState,
  content: CombatContent,
): readonly ActionSource[] {
  const sources: ActionSource[] = [];
  if (hasCondition(actor, "prone")) sources.push({ kind: "context", id: "stand" });
  if (hasCondition(actor, "grabbed")) sources.push({ kind: "context", id: "escape-grab" });

  const hasAdjacentObject = Object.values(state.map.objects).some(
    (object) => !object.used && gridDistance(actor.position, object.position) === 5,
  );
  if (hasAdjacentObject) sources.push({ kind: "context", id: "interact-lever" });

  const equipmentActions = getEquipment(actor, content).flatMap((equipment) => equipment.actionGrants);
  if (equipmentActions.includes("raise-shield")) {
    sources.push({ kind: "context", id: "raise-shield" });
  }

  const hasSustainedEffect = Object.values(state.effects).some(
    (effect) => effect.targetActorId === actor.id && effect.traits.some((trait) => trait.id === "sustained"),
  );
  if (hasSustainedEffect) sources.push({ kind: "context", id: "sustain-spell" });
  return sources;
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
    const equipmentName = content.equipment[card.source.objectId]?.name;
    return {
      definition,
      card,
      sourceLabel: equipmentName ?? card.source.objectId,
    };
  }

  const definition = content.actions[source.id];
  if (!definition) return null;
  if (source.kind === "basic" && !BASIC_ACTION_IDS.includes(source.id as (typeof BASIC_ACTION_IDS)[number])) {
    return null;
  }
  if (
    source.kind === "context" &&
    !getContextActionSources(state, actor, content).some((candidate) => candidate.id === source.id)
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

export function listLegalTargets(
  state: CombatState,
  actorId: string,
  source: ActionSource,
  content: CombatContent,
): readonly LegalTarget[] {
  const actor = state.actors[actorId];
  if (!actor || actor.defeated || state.outcome) return [];
  const resolved = resolveActionSource(state, actor, source, content);
  if (!resolved) return [];
  const definition = resolved.definition;

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

function actionAvailabilityReason(
  state: CombatState,
  actor: ActorState,
  source: ActionSource,
  definition: ActionDefinition,
  content: CombatContent,
): string | undefined {
  if (state.outcome) return "Combat has ended.";
  if (state.pendingReaction) return "A reaction decision is pending.";
  if (definition.timing.kind === "reaction") return "Requires a reaction trigger.";
  if (state.turn.activeActorId !== actor.id) return "Not this actor's turn.";
  if (definition.timing.actions > state.turn.actionsRemaining) return "Not enough actions remaining.";
  if (source.kind === "context" && source.id === "raise-shield" && actor.shieldRaised) {
    return "Shield is already raised.";
  }
  if (listLegalTargets(state, actor.id, source, content).length === 0) return "No legal target.";
  return undefined;
}

export function listLegalActions(
  state: CombatState,
  actorId: string,
  content: CombatContent,
): readonly LegalAction[] {
  const actor = state.actors[actorId];
  if (!actor) return [];
  const sources: ActionSource[] = [
    ...BASIC_ACTION_IDS.map((id) => ({ kind: "basic" as const, id })),
    ...getContextActionSources(state, actor, content),
    ...actor.innateActionIds.map((id) => ({ kind: "innate" as const, id })),
    ...(state.cardZones[actor.id]?.hand.map((card) => ({ kind: "card" as const, id: card.id })) ?? []),
  ];

  return sources.flatMap((source) => {
    const resolved = resolveActionSource(state, actor, source, content);
    if (!resolved) return [];
    const reason = actionAvailabilityReason(state, actor, source, resolved.definition, content);
    return [
      {
        source,
        actionId: resolved.definition.id,
        name: resolved.definition.name,
        description: resolved.definition.description,
        timing: resolved.definition.timing,
        traits: resolved.definition.traits.map((trait) => trait.id),
        enabled: !reason,
        reason,
        sourceLabel: resolved.sourceLabel,
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
  const resolved = resolveActionSource(state, actor, source, content);
  if (!resolved) return { legal: false, reason: "Unknown action source.", notes: [] };
  const legalTargets = listLegalTargets(state, actorId, source, content);
  if (!targetIsLegal(legalTargets, target)) {
    return { legal: false, reason: "Illegal target.", notes: [] };
  }

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
