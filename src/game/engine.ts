import { rollCheck } from "./checks";
import { findPath, getTile, gridDistance, hasLineOfSight, positionKey } from "./grid";
import { resolveActionSource, validateActionIntent } from "./queries";
import { createRng, rollDice, shuffle } from "./rng";
import {
  getEquipment,
  getEquipmentCardGrants,
  getStatistic,
  getWeaponProfile,
  hasTrait,
  isDirectlyBehind,
  isInFrontOrSide,
  isSuccessful,
} from "./rules";
import type {
  ActionDefinition,
  ActionSource,
  ActorState,
  BattleMapState,
  CardInstance,
  CardZones,
  CombatCommand,
  CombatDefinition,
  CombatContent,
  CombatEvent,
  CombatSetupResult,
  CombatState,
  CommandResult,
  ConditionInstance,
  EffectInstance,
  MapObjectState,
  PendingReaction,
  RngState,
  TileState,
  TurnState,
} from "./types";

interface CombatDraft {
  version: 2;
  scenarioId: string;
  seed: number;
  contentIdentity: CombatState["contentIdentity"];
  round: number;
  turn: TurnState;
  actors: Record<string, ActorState>;
  map: BattleMapState;
  effects: Record<string, EffectInstance>;
  cardZones: Record<string, CardZones>;
  rng: RngState;
  sequence: number;
  nextEffectSequence: number;
  pendingReaction: PendingReaction | null;
  outcome: CombatState["outcome"];
  commandLog: CombatCommand[];
}

function cloneActor(actor: ActorState): ActorState {
  return {
    ...actor,
    position: { ...actor.position },
    fallbackWeapon: { ...actor.fallbackWeapon, damage: { ...actor.fallbackWeapon.damage } },
    conditions: actor.conditions.map((condition) => ({ ...condition })),
    traits: actor.traits.map((trait) => ({ ...trait, params: trait.params ? { ...trait.params } : undefined })),
    equipmentIds: [...actor.equipmentIds],
    innateActionIds: [...actor.innateActionIds],
    baseCardGrants: actor.baseCardGrants.map((grant) => ({ ...grant })),
  };
}

function cloneTile(tile: TileState): TileState {
  return {
    ...tile,
    position: { ...tile.position },
    traits: tile.traits.map((trait) => ({ ...trait, params: trait.params ? { ...trait.params } : undefined })),
  };
}

function cloneObject(object: MapObjectState): MapObjectState {
  return {
    ...object,
    position: { ...object.position },
    traits: object.traits.map((trait) => ({ ...trait, params: trait.params ? { ...trait.params } : undefined })),
    interaction: { ...object.interaction },
  };
}

function cloneCard(card: CardInstance): CardInstance {
  return { ...card, source: { ...card.source } };
}

function cloneState(state: CombatState): CombatDraft {
  return {
    ...state,
    contentIdentity: { ...state.contentIdentity },
    turn: {
      ...state.turn,
      initiativeOrder: [...state.turn.initiativeOrder],
      lockedActionIds: [...state.turn.lockedActionIds],
    },
    actors: Object.fromEntries(Object.values(state.actors).map((actor) => [actor.id, cloneActor(actor)])),
    map: {
      ...state.map,
      tiles: Object.fromEntries(Object.values(state.map.tiles).map((tile) => [positionKey(tile.position), cloneTile(tile)])),
      objects: Object.fromEntries(Object.values(state.map.objects).map((object) => [object.id, cloneObject(object)])),
    },
    effects: Object.fromEntries(
      Object.values(state.effects).map((effect) => [
        effect.id,
        { ...effect, traits: effect.traits.map((trait) => ({ ...trait })) },
      ]),
    ),
    cardZones: Object.fromEntries(
      Object.entries(state.cardZones).map(([actorId, zones]) => [
        actorId,
        {
          drawPile: zones.drawPile.map(cloneCard),
          hand: zones.hand.map(cloneCard),
          discardPile: zones.discardPile.map(cloneCard),
        },
      ]),
    ),
    rng: { ...state.rng },
    pendingReaction: state.pendingReaction
      ? {
          ...state.pendingReaction,
          candidates: state.pendingReaction.candidates.map((candidate) => ({ ...candidate })),
          continuation: {
            ...state.pendingReaction.continuation,
            source: { ...state.pendingReaction.continuation.source },
            path: state.pendingReaction.continuation.path.map((position) => ({ ...position })),
            destination: { ...state.pendingReaction.continuation.destination },
          },
        }
      : null,
    commandLog: [...state.commandLog],
  };
}

function asState(draft: CombatDraft): CombatState {
  return draft;
}

function fail(state: CombatState, error: string): CommandResult {
  return { accepted: false, state, events: [], error };
}

function makeCardInstances(actor: ActorState, content: CombatContent): readonly CardInstance[] {
  const grants = [
    ...actor.baseCardGrants,
    ...getEquipmentCardGrants(actor, content),
  ];
  const instances: CardInstance[] = [];
  let sequence = 1;

  for (const grant of grants) {
    for (let copy = 0; copy < grant.count; copy += 1) {
      instances.push({
        id: `${actor.id}-card-${String(sequence).padStart(2, "0")}`,
        definitionId: grant.cardDefinitionId,
        source: { objectId: grant.sourceId, traitId: grant.traitId },
      });
      sequence += 1;
    }
  }
  return instances;
}

export function createCombat(definition: CombatDefinition, seed: number): CombatSetupResult {
  const { scenario, content, contentIdentity } = definition;
  let rng = createRng(seed);
  const actors = Object.fromEntries(
    scenario.actors.map((setup) => [
      setup.id,
      {
        ...cloneActor({ ...setup, reactionAvailable: false, shieldRaised: false, defeated: false }),
      },
    ]),
  );
  const events: CombatEvent[] = [{ type: "COMBAT_STARTED", scenarioId: scenario.id, seed }];
  const cardZones: Record<string, CardZones> = {};

  for (const actor of Object.values(actors).sort((left, right) => left.id.localeCompare(right.id))) {
    const shuffled = shuffle(makeCardInstances(actor, content), rng);
    rng = shuffled.rng;
    const hand = shuffled.values.slice(0, 6);
    const drawPile = shuffled.values.slice(6);
    cardZones[actor.id] = { hand, drawPile, discardPile: [] };
    for (const card of hand) {
      events.push({ type: "CARD_DRAWN", actorId: actor.id, cardInstanceId: card.id });
    }
  }

  const initiatives: { readonly actorId: string; readonly total: number }[] = [];
  for (const actor of Object.values(actors).sort((left, right) => left.id.localeCompare(right.id))) {
    const check = rollCheck(rng, actor.initiativeModifier, 0);
    rng = check.rng;
    initiatives.push({ actorId: actor.id, total: check.total });
    events.push({
      type: "INITIATIVE_ROLLED",
      actorId: actor.id,
      roll: check.roll,
      modifier: actor.initiativeModifier,
      total: check.total,
    });
  }
  initiatives.sort((left, right) => right.total - left.total || left.actorId.localeCompare(right.actorId));
  const initiativeOrder = initiatives.map((entry) => entry.actorId);
  const activeActorId = initiativeOrder[0];
  if (!activeActorId) throw new Error("A combat scenario requires at least one actor.");
  const activeActor = actors[activeActorId];
  if (activeActor) actors[activeActorId] = { ...activeActor, reactionAvailable: true };

  const state: CombatState = {
    version: 2,
    scenarioId: scenario.id,
    seed,
    contentIdentity: { ...contentIdentity },
    round: 1,
    turn: {
      initiativeOrder,
      activeIndex: 0,
      activeActorId,
      actionsRemaining: 3,
      attacksThisTurn: 0,
      turnNumber: 1,
      lockedActionIds: [],
    },
    actors,
    map: {
      ...scenario.map,
      tiles: Object.fromEntries(Object.values(scenario.map.tiles).map((tile) => [positionKey(tile.position), cloneTile(tile)])),
      objects: Object.fromEntries(Object.values(scenario.map.objects).map((object) => [object.id, cloneObject(object)])),
    },
    effects: {},
    cardZones,
    rng,
    sequence: 0,
    nextEffectSequence: 1,
    pendingReaction: null,
    outcome: null,
    commandLog: [],
  };
  events.push({ type: "TURN_STARTED", actorId: activeActorId, round: 1 });
  return { state, events };
}

function replaceActor(draft: CombatDraft, actor: ActorState): void {
  draft.actors[actor.id] = actor;
}

function addCondition(
  draft: CombatDraft,
  actorId: string,
  condition: ConditionInstance["id"],
  sourceId: string,
  events: CombatEvent[],
): void {
  const actor = draft.actors[actorId];
  if (!actor || actor.conditions.some((entry) => entry.id === condition)) return;
  replaceActor(draft, {
    ...actor,
    conditions: [...actor.conditions, { id: condition, sourceId }],
  });
  events.push({ type: "CONDITION_APPLIED", actorId, condition, sourceId });
}

function removeCondition(
  draft: CombatDraft,
  actorId: string,
  condition: ConditionInstance["id"],
  events: CombatEvent[],
): void {
  const actor = draft.actors[actorId];
  if (!actor || !actor.conditions.some((entry) => entry.id === condition)) return;
  replaceActor(draft, {
    ...actor,
    conditions: actor.conditions.filter((entry) => entry.id !== condition),
  });
  events.push({ type: "CONDITION_REMOVED", actorId, condition });
}

function discardCard(
  draft: CombatDraft,
  actorId: string,
  cardInstanceId: string,
  events: CombatEvent[],
): void {
  const zones = draft.cardZones[actorId];
  if (!zones) return;
  const card = zones.hand.find((entry) => entry.id === cardInstanceId);
  if (!card) return;
  draft.cardZones[actorId] = {
    ...zones,
    hand: zones.hand.filter((entry) => entry.id !== cardInstanceId),
    discardPile: [...zones.discardPile, card],
  };
  events.push({ type: "CARD_PLAYED", actorId, cardInstanceId });
}

function drawCard(draft: CombatDraft, actorId: string, events: CombatEvent[]): void {
  let zones = draft.cardZones[actorId];
  if (!zones) return;
  if (zones.drawPile.length === 0 && zones.discardPile.length > 0) {
    const shuffled = shuffle(zones.discardPile, draft.rng);
    draft.rng = shuffled.rng;
    zones = { hand: zones.hand, drawPile: shuffled.values, discardPile: [] };
    draft.cardZones[actorId] = zones;
    events.push({ type: "DISCARD_RESHUFFLED", actorId });
  }
  const card = zones.drawPile[0];
  if (!card) return;
  draft.cardZones[actorId] = {
    ...zones,
    drawPile: zones.drawPile.slice(1),
    hand: [...zones.hand, card],
  };
  events.push({ type: "CARD_DRAWN", actorId, cardInstanceId: card.id });
}

function checkCombatOutcome(draft: CombatDraft, events: CombatEvent[]): void {
  if (draft.outcome) return;
  const heroesAlive = Object.values(draft.actors).some((actor) => actor.team === "heroes" && !actor.defeated);
  const enemiesAlive = Object.values(draft.actors).some((actor) => actor.team === "enemies" && !actor.defeated);
  if (heroesAlive && enemiesAlive) return;
  draft.outcome = heroesAlive ? "victory" : "defeat";
  events.push({ type: "COMBAT_ENDED", outcome: draft.outcome });
}

function applyDamage(
  draft: CombatDraft,
  sourceActorId: string,
  targetActorId: string,
  amount: number,
  damageType: "slashing" | "piercing" | "bludgeoning" | "force",
  events: CombatEvent[],
): void {
  const target = draft.actors[targetActorId];
  if (!target || target.defeated) return;
  const hp = Math.max(0, target.hp - amount);
  const defeated = hp === 0;
  replaceActor(draft, { ...target, hp, defeated });
  events.push({ type: "DAMAGE_DEALT", sourceActorId, targetActorId, amount, damageType, remainingHp: hp });
  if (defeated) events.push({ type: "ACTOR_DEFEATED", actorId: targetActorId });
  checkCombatOutcome(draft, events);
}

function currentMapPenalty(draft: CombatDraft): number {
  return [0, -5, -10][Math.min(2, draft.turn.attacksThisTurn)] as number;
}

function performWeaponAttack(
  draft: CombatDraft,
  actorId: string,
  targetActorId: string,
  definition: ActionDefinition,
  content: CombatContent,
  events: CombatEvent[],
  mapPenalty: number,
): void {
  const actor = draft.actors[actorId];
  const target = draft.actors[targetActorId];
  if (!actor || !target || definition.effect.kind !== "weapon-attack") return;
  const weapon = getWeaponProfile(actor, content);
  const targetAc = getStatistic(target, content, "ac");
  const rearAdjustment = isDirectlyBehind(actor.position, target) ? -2 : 0;
  const modifier = weapon.attackModifier + mapPenalty;
  const check = rollCheck(draft.rng, modifier, targetAc.value + rearAdjustment);
  draft.rng = check.rng;
  events.push({
    type: "CHECK_ROLLED",
    actorId,
    targetActorId,
    label: definition.name,
    roll: check.roll,
    modifier,
    dc: targetAc.value + rearAdjustment,
    baseDegree: check.baseDegree,
    degree: check.degree,
    modifierSources: [
      `${weapon.name} ${weapon.attackModifier >= 0 ? "+" : ""}${weapon.attackModifier}`,
      ...(mapPenalty ? [`MAP ${mapPenalty}`] : []),
      ...(rearAdjustment ? ["Rear attack: target AC -2"] : []),
      ...targetAc.sources,
    ],
  });
  if (!isSuccessful(check.degree)) return;

  const damageRoll = rollDice(draft.rng, weapon.damage.count, weapon.damage.sides);
  draft.rng = damageRoll.rng;
  const criticalMultiplier = check.degree === "critical-success" ? 2 : 1;
  const damage = Math.max(
    0,
    (damageRoll.total + weapon.damage.modifier) * definition.effect.damageMultiplier * criticalMultiplier,
  );
  applyDamage(draft, actorId, targetActorId, damage, weapon.damage.damageType, events);
  if (definition.effect.applyCondition && !draft.actors[targetActorId]?.defeated) {
    addCondition(draft, targetActorId, definition.effect.applyCondition, definition.id, events);
  }
}

function performTrip(
  draft: CombatDraft,
  actorId: string,
  targetActorId: string,
  definition: ActionDefinition,
  content: CombatContent,
  events: CombatEvent[],
  mapPenalty: number,
): void {
  const actor = draft.actors[actorId];
  const target = draft.actors[targetActorId];
  if (!actor || !target) return;
  const reflex = getStatistic(target, content, "reflex");
  const modifier = actor.athleticsModifier + mapPenalty;
  const check = rollCheck(draft.rng, modifier, reflex.value);
  draft.rng = check.rng;
  events.push({
    type: "CHECK_ROLLED",
    actorId,
    targetActorId,
    label: definition.name,
    roll: check.roll,
    modifier,
    dc: reflex.value,
    baseDegree: check.baseDegree,
    degree: check.degree,
    modifierSources: [
      `Athletics +${actor.athleticsModifier}`,
      ...(mapPenalty ? [`MAP ${mapPenalty}`] : []),
      ...reflex.sources,
    ],
  });
  if (isSuccessful(check.degree)) addCondition(draft, targetActorId, "prone", definition.id, events);
}

function eligibleMoveReactions(
  draft: CombatDraft,
  mover: ActorState,
  content: CombatContent,
): PendingReaction["candidates"] {
  return Object.values(draft.actors)
    .filter((actor) => {
      if (actor.team === mover.team || actor.defeated || !actor.reactionAvailable) return false;
      const weapon = getWeaponProfile(actor, content);
      return (
        gridDistance(actor.position, mover.position) <= weapon.rangeFeet &&
        isInFrontOrSide(actor, mover.position) &&
        hasLineOfSight(draft.map, actor.position, mover.position)
      );
    })
    .flatMap((actor) => {
      const card = draft.cardZones[actor.id]?.hand.find(
        (candidate) => content.cards[candidate.definitionId]?.actionId === "reactive-strike",
      );
      return card
        ? [{ actorId: actor.id, cardInstanceId: card.id, actionId: "reactive-strike" }]
        : [];
    })
    .sort((left, right) => left.actorId.localeCompare(right.actorId));
}

function applyWebTerrain(
  draft: CombatDraft,
  actorId: string,
  movementMode: "land" | "fly",
  events: CombatEvent[],
  content: CombatContent,
): void {
  if (movementMode === "fly") return;
  const actor = draft.actors[actorId];
  if (!actor) return;
  const tile = getTile(draft.map, actor.position);
  if (!tile || !hasTrait(tile, "web")) return;
  const reflex = getStatistic(actor, content, "reflex");
  const modifier = reflex.value - 10;
  const check = rollCheck(draft.rng, modifier, 15);
  draft.rng = check.rng;
  events.push({
    type: "CHECK_ROLLED",
    actorId,
    label: "Web Terrain",
    roll: check.roll,
    modifier,
    dc: 15,
    baseDegree: check.baseDegree,
    degree: check.degree,
    modifierSources: reflex.sources,
  });
  if (!isSuccessful(check.degree)) addCondition(draft, actorId, "grabbed", tile.id, events);
}

function completeMove(
  draft: CombatDraft,
  continuation: PendingReaction["continuation"],
  content: CombatContent,
  events: CombatEvent[],
): void {
  const actor = draft.actors[continuation.actorId];
  if (!actor || actor.defeated || draft.outcome) return;
  replaceActor(draft, {
    ...actor,
    position: { ...continuation.destination },
    facing: continuation.facing,
  });
  events.push({
    type: "ACTOR_MOVED",
    actorId: actor.id,
    path: continuation.path,
    movementMode: continuation.movementMode,
  });
  events.push({ type: "FACING_CHANGED", actorId: actor.id, facing: continuation.facing });
  applyWebTerrain(draft, actor.id, continuation.movementMode, events, content);
}

function executeMove(
  draft: CombatDraft,
  actorId: string,
  source: ActionSource,
  definition: ActionDefinition,
  target: Extract<CombatCommand, { type: "use-action" }>["target"],
  content: CombatContent,
  events: CombatEvent[],
): void {
  if (definition.effect.kind !== "move" || target.kind !== "tile") return;
  const actor = draft.actors[actorId];
  if (!actor) return;
  const maximumCost = definition.effect.step ? 5 : actor.speedFeet;
  const path = findPath(
    draft.map,
    draft.actors,
    actor.id,
    actor.position,
    target.position,
    maximumCost,
    definition.effect.movementMode,
  );
  if (!path) return;
  const continuation: PendingReaction["continuation"] = {
    kind: "move",
    actorId,
    actionId: definition.id,
    source,
    path: path.path,
    destination: target.position,
    facing: target.facing,
    movementMode: definition.effect.movementMode,
  };
  const candidates = definition.effect.triggersReactions
    ? eligibleMoveReactions(draft, actor, content)
    : [];
  if (candidates.length > 0) {
    const triggerId = `reaction-${draft.sequence}`;
    draft.pendingReaction = {
      triggerId,
      type: "enemy-move",
      sourceActorId: actor.id,
      candidates,
      continuation,
    };
    events.push({
      type: "REACTION_OPENED",
      triggerId,
      sourceActorId: actor.id,
      candidateActorIds: candidates.map((candidate) => candidate.actorId),
    });
    return;
  }
  completeMove(draft, continuation, content, events);
}

function executeRemoveCondition(
  draft: CombatDraft,
  actorId: string,
  definition: ActionDefinition,
  events: CombatEvent[],
): void {
  if (definition.effect.kind !== "remove-condition") return;
  removeCondition(draft, actorId, definition.effect.condition, events);
}

function executeRecoveryCheck(
  draft: CombatDraft,
  actorId: string,
  definition: ActionDefinition,
  events: CombatEvent[],
  mapPenalty: number,
): void {
  if (definition.effect.kind !== "recovery-check") return;
  const actor = draft.actors[actorId];
  if (!actor) return;
  const modifier = actor.athleticsModifier + mapPenalty;
  const check = rollCheck(draft.rng, modifier, definition.effect.dc);
  draft.rng = check.rng;
  events.push({
    type: "CHECK_ROLLED",
    actorId,
    label: definition.name,
    roll: check.roll,
    modifier,
    dc: definition.effect.dc,
    baseDegree: check.baseDegree,
    degree: check.degree,
    modifierSources: [
      `Athletics +${actor.athleticsModifier}`,
      ...(mapPenalty ? [`MAP ${mapPenalty}`] : []),
    ],
  });

  for (const outcome of definition.effect.outcomes[check.degree]) {
    if (outcome.kind === "remove-condition") {
      removeCondition(draft, actorId, outcome.condition, events);
    } else if (!draft.turn.lockedActionIds.includes(outcome.actionId)) {
      draft.turn = {
        ...draft.turn,
        lockedActionIds: [...draft.turn.lockedActionIds, outcome.actionId],
      };
      events.push({ type: "ACTION_LOCKED", actorId, actionId: outcome.actionId });
    }
  }
}

function executeInteract(
  draft: CombatDraft,
  actorId: string,
  target: Extract<CombatCommand, { type: "use-action" }>["target"],
  events: CombatEvent[],
): void {
  if (target.kind !== "object") return;
  const object = draft.map.objects[target.objectId];
  if (!object || object.used) return;
  draft.map = {
    ...draft.map,
    objects: { ...draft.map.objects, [object.id]: { ...object, used: true } },
  };
  events.push({ type: "OBJECT_INTERACTED", objectId: object.id, actorId });

  const targetTile = Object.values(draft.map.tiles).find((tile) => tile.id === object.interaction.targetTileId);
  if (!targetTile) return;
  const traits = [
    ...targetTile.traits.filter((trait) => trait.id !== "blocked" && trait.id !== "gate"),
    { id: "open", sourceId: object.id },
    { id: "gate-open", sourceId: object.id },
  ];
  const tile = { ...targetTile, traits };
  draft.map = {
    ...draft.map,
    tiles: { ...draft.map.tiles, [positionKey(tile.position)]: tile },
  };
  events.push({ type: "TERRAIN_CHANGED", tileId: tile.id, traits: traits.map((trait) => trait.id) });
}

function executeSustainedEffect(
  draft: CombatDraft,
  actorId: string,
  definition: ActionDefinition,
  target: Extract<CombatCommand, { type: "use-action" }>["target"],
  events: CombatEvent[],
): void {
  if (definition.effect.kind === "create-sustained-effect") {
    const id = `effect-${String(draft.nextEffectSequence).padStart(3, "0")}`;
    draft.nextEffectSequence += 1;
    draft.effects[id] = {
      id,
      name: definition.effect.effectName,
      sourceId: definition.id,
      targetActorId: actorId,
      traits: [{ id: "sustained", sourceId: definition.id }],
      createdOnTurn: draft.turn.turnNumber,
      sustainedOnTurn: null,
    };
    events.push({ type: "EFFECT_CREATED", effectId: id, actorId, name: definition.effect.effectName });
    return;
  }
  if (definition.effect.kind === "sustain-effect" && target.kind === "effect") {
    const effect = draft.effects[target.effectId];
    if (!effect) return;
    draft.effects[target.effectId] = { ...effect, sustainedOnTurn: draft.turn.turnNumber };
    events.push({ type: "EFFECT_SUSTAINED", effectId: effect.id, actorId });
  }
}

function executeAction(
  draft: CombatDraft,
  actorId: string,
  source: ActionSource,
  definition: ActionDefinition,
  target: Extract<CombatCommand, { type: "use-action" }>["target"],
  content: CombatContent,
  events: CombatEvent[],
  mapPenalty: number,
): void {
  switch (definition.effect.kind) {
    case "move":
      executeMove(draft, actorId, source, definition, target, content, events);
      break;
    case "weapon-attack":
      if (target.kind === "actor") {
        performWeaponAttack(draft, actorId, target.actorId, definition, content, events, mapPenalty);
      }
      break;
    case "trip":
      if (target.kind === "actor") performTrip(draft, actorId, target.actorId, definition, content, events, mapPenalty);
      break;
    case "remove-condition":
      executeRemoveCondition(draft, actorId, definition, events);
      break;
    case "recovery-check":
      executeRecoveryCheck(draft, actorId, definition, events, mapPenalty);
      break;
    case "raise-shield": {
      const actor = draft.actors[actorId];
      const shield = actor ? getEquipment(actor, content).find((equipment) => equipment.shieldBonus) : undefined;
      if (actor && shield?.shieldBonus) {
        replaceActor(draft, { ...actor, shieldRaised: true });
        events.push({ type: "SHIELD_RAISED", actorId, bonus: shield.shieldBonus });
      }
      break;
    }
    case "interact":
      executeInteract(draft, actorId, target, events);
      break;
    case "create-sustained-effect":
    case "sustain-effect":
      executeSustainedEffect(draft, actorId, definition, target, events);
      break;
  }
}

function expireUnsustainedEffects(draft: CombatDraft, actorId: string, events: CombatEvent[]): void {
  for (const effect of Object.values(draft.effects)) {
    if (
      effect.targetActorId === actorId &&
      effect.createdOnTurn < draft.turn.turnNumber &&
      effect.sustainedOnTurn !== draft.turn.turnNumber
    ) {
      delete draft.effects[effect.id];
      events.push({ type: "EFFECT_EXPIRED", effectId: effect.id, actorId });
    }
  }
}

function advanceTurn(draft: CombatDraft, events: CombatEvent[]): void {
  const endedActorId = draft.turn.activeActorId;
  expireUnsustainedEffects(draft, endedActorId, events);
  events.push({ type: "TURN_ENDED", actorId: endedActorId });

  const order = draft.turn.initiativeOrder;
  let nextIndex = draft.turn.activeIndex;
  let wrapped = false;
  for (let count = 0; count < order.length; count += 1) {
    nextIndex = (nextIndex + 1) % order.length;
    if (nextIndex === 0) wrapped = true;
    const candidateId = order[nextIndex];
    if (candidateId && !draft.actors[candidateId]?.defeated) break;
  }
  const activeActorId = order[nextIndex];
  if (!activeActorId) return;
  if (wrapped) draft.round += 1;
  const activeActor = draft.actors[activeActorId];
  if (activeActor) {
    replaceActor(draft, { ...activeActor, reactionAvailable: true, shieldRaised: false });
  }
  draft.turn = {
    initiativeOrder: order,
    activeIndex: nextIndex,
    activeActorId,
    actionsRemaining: 3,
    attacksThisTurn: 0,
    turnNumber: draft.turn.turnNumber + 1,
    lockedActionIds: [],
  };
  drawCard(draft, activeActorId, events);
  events.push({ type: "TURN_STARTED", actorId: activeActorId, round: draft.round });
}

function validateSequence(state: CombatState, command: CombatCommand): string | undefined {
  if (command.sequence !== state.sequence + 1) {
    return `Expected command sequence ${state.sequence + 1}, received ${command.sequence}.`;
  }
  if (state.commandLog.some((entry) => entry.id === command.id)) return `Duplicate command id: ${command.id}.`;
  return undefined;
}

function beginAcceptedCommand(draft: CombatDraft, command: CombatCommand): void {
  draft.sequence = command.sequence;
  draft.commandLog.push(command);
}

function useAction(
  state: CombatState,
  command: Extract<CombatCommand, { type: "use-action" }>,
  content: CombatContent,
): CommandResult {
  const validation = validateActionIntent(
    state,
    command.actorId,
    command.action,
    command.target,
    content,
  );
  if (!validation.legal) return fail(state, validation.reason ?? "Action is not legal.");
  const actor = state.actors[command.actorId];
  if (!actor) return fail(state, "Unknown actor.");
  const resolved = resolveActionSource(state, actor, command.action, content);
  if (!resolved) return fail(state, "Action source is unavailable.");
  if (resolved.definition.timing.kind !== "turn") return fail(state, "Reaction cards require a trigger.");

  const draft = cloneState(state);
  const events: CombatEvent[] = [];
  beginAcceptedCommand(draft, command);
  const cost = resolved.definition.timing.actions;
  const mapPenalty = currentMapPenalty(draft);
  draft.turn = {
    ...draft.turn,
    actionsRemaining: draft.turn.actionsRemaining - cost,
    attacksThisTurn:
      draft.turn.attacksThisTurn + (resolved.definition.traits.some((trait) => trait.id === "attack") ? 1 : 0),
  };
  events.push({
    type: "ACTION_SPENT",
    actorId: actor.id,
    actionId: resolved.definition.id,
    amount: cost,
    remaining: draft.turn.actionsRemaining,
  });
  if (resolved.card) discardCard(draft, actor.id, resolved.card.id, events);
  executeAction(draft, actor.id, command.action, resolved.definition, command.target, content, events, mapPenalty);
  checkCombatOutcome(draft, events);
  return { accepted: true, state: asState(draft), events };
}

function endTurn(
  state: CombatState,
  command: Extract<CombatCommand, { type: "end-turn" }>,
): CommandResult {
  if (state.outcome) return fail(state, "Combat has ended.");
  if (state.pendingReaction) return fail(state, "Resolve the pending reaction first.");
  if (state.turn.activeActorId !== command.actorId) return fail(state, "Actor is not active.");
  const draft = cloneState(state);
  const events: CombatEvent[] = [];
  beginAcceptedCommand(draft, command);
  advanceTurn(draft, events);
  return { accepted: true, state: asState(draft), events };
}

function resumeAfterReaction(
  draft: CombatDraft,
  pending: PendingReaction,
  content: CombatContent,
  events: CombatEvent[],
): void {
  draft.pendingReaction = null;
  const mover = draft.actors[pending.sourceActorId];
  if (mover?.defeated) {
    checkCombatOutcome(draft, events);
    if (!draft.outcome) advanceTurn(draft, events);
    return;
  }
  completeMove(draft, pending.continuation, content, events);
  checkCombatOutcome(draft, events);
}

function useReaction(
  state: CombatState,
  command: Extract<CombatCommand, { type: "use-reaction" }>,
  content: CombatContent,
): CommandResult {
  const pending = state.pendingReaction;
  if (!pending || pending.triggerId !== command.triggerId) return fail(state, "Reaction trigger is unavailable.");
  const candidate = pending.candidates.find(
    (entry) => entry.actorId === command.actorId && entry.cardInstanceId === command.cardInstanceId,
  );
  if (!candidate) return fail(state, "Reaction candidate is unavailable.");
  const reactor = state.actors[command.actorId];
  const mover = state.actors[pending.sourceActorId];
  const definition = content.actions[candidate.actionId];
  if (!reactor || !mover || !definition || !reactor.reactionAvailable) return fail(state, "Reaction cannot resolve.");
  if (!isInFrontOrSide(reactor, mover.position)) return fail(state, "Mover is outside the reaction facing arc.");

  const draft = cloneState(state);
  const events: CombatEvent[] = [];
  beginAcceptedCommand(draft, command);
  replaceActor(draft, { ...reactor, reactionAvailable: false });
  discardCard(draft, reactor.id, candidate.cardInstanceId, events);
  events.push({ type: "REACTION_USED", triggerId: pending.triggerId, actorId: reactor.id, actionId: definition.id });
  performWeaponAttack(draft, reactor.id, mover.id, definition, content, events, 0);
  resumeAfterReaction(draft, pending, content, events);
  return { accepted: true, state: asState(draft), events };
}

function passReaction(
  state: CombatState,
  command: Extract<CombatCommand, { type: "pass-reaction" }>,
  content: CombatContent,
): CommandResult {
  const pending = state.pendingReaction;
  if (!pending || pending.triggerId !== command.triggerId) return fail(state, "Reaction trigger is unavailable.");
  if (!pending.candidates.some((candidate) => candidate.actorId === command.actorId)) {
    return fail(state, "Actor cannot pass this reaction.");
  }
  const draft = cloneState(state);
  const events: CombatEvent[] = [];
  beginAcceptedCommand(draft, command);
  events.push({ type: "REACTION_PASSED", triggerId: pending.triggerId, actorId: command.actorId });
  const remaining = pending.candidates.filter((candidate) => candidate.actorId !== command.actorId);
  if (remaining.length > 0) {
    draft.pendingReaction = { ...pending, candidates: remaining };
  } else {
    resumeAfterReaction(draft, pending, content, events);
  }
  return { accepted: true, state: asState(draft), events };
}

export function dispatchCombatCommand(
  state: CombatState,
  command: CombatCommand,
  content: CombatContent,
): CommandResult {
  const sequenceError = validateSequence(state, command);
  if (sequenceError) return fail(state, sequenceError);
  switch (command.type) {
    case "use-action":
      return useAction(state, command, content);
    case "end-turn":
      return endTurn(state, command);
    case "use-reaction":
      return useReaction(state, command, content);
    case "pass-reaction":
      return passReaction(state, command, content);
  }
}
