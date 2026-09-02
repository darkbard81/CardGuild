import { attacksForMap, resolveMapPenalty, resolveStrike } from "./offense";
import { isDirectlyBehind } from "./rules";
import {
  formatStatisticSources,
  proficiencyRankAtLeast,
  resolveArmorClass,
  resolveClassDC,
  resolveStatisticDC,
  resolveStatisticModifier,
  type StatisticResolutionContext,
} from "./statistics";
import type {
  ActionCheckDefinition,
  ActionDcRef,
  ActionDefinition,
  ActionRequirement,
  ActionMapContext,
  ActionOutcomeEffect,
  ActionParticipant,
  ActionSource,
  ActionStatisticRef,
  ActionTarget,
  ActorState,
  CombatContent,
  CombatState,
  DegreeOutcomeMap,
  EntityId,
  MovementMode,
  ResolvedStatistic,
  ResolvedStrikeProfile,
  StatisticContextModifier,
  StatisticSource,
} from "./types";

/** The two actors a resolution may refer to. `target` is absent for self-targeted Actions. */
export interface ActionParticipants {
  readonly actor: ActorState;
  readonly target?: ActorState;
}

export interface ResolvedActionCheck {
  readonly roller: ActionParticipant;
  readonly rollerActorId: EntityId;
  readonly modifier: number;
  readonly dc: number;
  readonly modifierSources: readonly StatisticSource[];
  readonly dcSources: readonly StatisticSource[];
}

export type ResolvedActionResolution =
  | {
      readonly kind: "move";
      readonly movementMode: MovementMode;
      readonly step: boolean;
      readonly triggersReactions: boolean;
    }
  | {
      readonly kind: "strike";
      readonly check: ResolvedActionCheck;
      readonly strike: ResolvedStrikeProfile;
      readonly damageMultiplier: number;
      readonly outcomes: DegreeOutcomeMap;
    }
  | {
      readonly kind: "check";
      readonly check: ResolvedActionCheck;
      readonly outcomes: DegreeOutcomeMap;
    }
  | { readonly kind: "direct"; readonly effects: readonly ActionOutcomeEffect[] };

/**
 * Everything a check or effect needs, computed without touching the RNG. Preview and
 * execution both build one of these first, so the numbers a player is shown are
 * structurally the same numbers that get rolled against.
 */
export interface ResolvedActionPlan {
  readonly actionId: string;
  readonly actionActorId: EntityId;
  readonly targetActorId?: EntityId;
  readonly source: ActionSource;
  readonly target: ActionTarget;
  readonly label: string;
  readonly resolution: ResolvedActionResolution;
  readonly notes: readonly string[];
}

export function turnMapContext(state: CombatState): ActionMapContext {
  return { kind: "turn", attacksThisTurn: state.turn.attacksThisTurn };
}

function participant(participants: ActionParticipants, owner: ActionParticipant): ActorState | undefined {
  return owner === "actor" ? participants.actor : participants.target;
}

/**
 * A Skill/Save/Perception check through the #7 resolver. The multiple attack penalty
 * arrives as an ordinary context modifier so it stacks under the same rules as anything
 * else, and only the acting side ever carries it — a target rolling a save does not.
 */
export function resolveActionStatistic(
  actor: ActorState,
  statistic: ActionStatisticRef,
  context: StatisticResolutionContext,
  mapPenalty = 0,
): ResolvedStatistic {
  const selector = statistic.kind === "skill"
    ? { kind: "skill" as const, id: statistic.skill, attributeOverride: statistic.attributeOverride }
    : statistic.kind === "save"
      ? { kind: "save" as const, id: statistic.save }
      : { kind: "perception" as const };
  const modifiers: readonly StatisticContextModifier[] = mapPenalty
    ? [{
        selector: { kind: "all" },
        type: "untyped",
        value: mapPenalty,
        label: "Multiple attack penalty",
        sourceId: "multiple-attack-penalty",
      }]
    : [];
  return resolveStatisticModifier(actor, selector, { ...context, modifiers: [...(context.modifiers ?? []), ...modifiers] });
}

/** Delegates to the #7 statistic DC, the #8 Armor Class, or the #9 Class DC. */
export function resolveActionDc(
  dc: ActionDcRef,
  participants: ActionParticipants,
  context: StatisticResolutionContext,
): ResolvedStatistic | null {
  if (dc.kind === "fixed") {
    return { value: dc.value, sources: [{ kind: "dc", sourceId: "authored-dc", label: "Authored DC", value: dc.value, applied: true }] };
  }
  const owner = participant(participants, dc.owner);
  if (!owner) return null;
  if (dc.kind === "armor-class") return resolveArmorClass(owner, context);
  if (dc.kind === "class-dc") {
    // Class DC is Character-only (#9). A Creature owner is a legal authoring shape that
    // this participant cannot satisfy, so the plan is unresolvable instead of throwing.
    return owner.statProfile.kind === "character" ? resolveClassDC(owner, context) : null;
  }
  const selector = dc.statistic.kind === "skill"
    ? { kind: "skill" as const, id: dc.statistic.skill, attributeOverride: dc.statistic.attributeOverride }
    : dc.statistic.kind === "save"
      ? { kind: "save" as const, id: dc.statistic.save }
      : { kind: "perception" as const };
  return resolveStatisticDC(owner, selector, context);
}

function resolveCheck(
  definition: ActionCheckDefinition,
  participants: ActionParticipants,
  context: StatisticResolutionContext,
  mapPenalty: number,
): ResolvedActionCheck | null {
  const roller = participant(participants, definition.roller);
  if (!roller) return null;
  const dc = resolveActionDc(definition.dc, participants, context);
  if (!dc) return null;
  // MAP belongs to the acting side's attack sequence, never to a target's save.
  const modifier = resolveActionStatistic(
    roller,
    definition.statistic,
    context,
    definition.roller === "actor" ? mapPenalty : 0,
  );
  return {
    roller: definition.roller,
    rollerActorId: roller.id,
    modifier: modifier.value,
    dc: dc.value,
    modifierSources: modifier.sources,
    dcSources: dc.sources,
  };
}

/**
 * Whether one capability gate is met. Each kind reads an existing source of truth — the #9
 * resolved Strike, the Actor's equipment, the #7 Character profile — so a requirement can
 * only observe the rules, never restate them.
 */
function requirementMet(
  requirement: ActionRequirement,
  actor: ActorState,
  context: StatisticResolutionContext,
): boolean {
  if (requirement.kind === "weapon-mode") {
    // A Creature's authored Strike declares only a range, so it satisfies no weapon mode.
    return resolveStrike(actor, context).attackMode === requirement.mode;
  }
  if (requirement.kind === "equipped-slot") {
    return actor.equipmentIds.some((id) => context.content.equipment[id]?.slot === requirement.slot);
  }
  // Skill ranks live on the Character profile; a Creature carries final numbers instead.
  if (actor.statProfile.kind !== "character") return false;
  return proficiencyRankAtLeast(actor.statProfile.stats.skills[requirement.skill], requirement.minimum);
}

export function meetsActionRequirements(
  definition: ActionDefinition,
  actor: ActorState,
  context: StatisticResolutionContext,
): boolean {
  return (definition.requirements ?? []).every((requirement) => requirementMet(requirement, actor, context));
}

/** A Strike rolls its #9 attack modifier against the target's #8 Armor Class. */
function resolveStrikeCheck(
  participants: ActionParticipants,
  context: StatisticResolutionContext,
  attacksThisTurn: number,
  extraWeaponDice: number,
): { readonly check: ResolvedActionCheck; readonly strike: ResolvedStrikeProfile } | null {
  const { actor, target } = participants;
  if (!target) return null;
  const strike = resolveStrike(actor, context, { attacksThisTurn, extraWeaponDice });
  const armorClass = resolveArmorClass(target, context);
  const rearAdjustment = isDirectlyBehind(actor.position, target) ? -2 : 0;
  const rearSources: readonly StatisticSource[] = rearAdjustment
    ? [{ kind: "position", sourceId: "rear-attack", label: "Rear attack: target AC", value: rearAdjustment, applied: true }]
    : [];
  return {
    strike,
    check: {
      roller: "actor",
      rollerActorId: actor.id,
      modifier: strike.attackModifier,
      dc: armorClass.value + rearAdjustment,
      modifierSources: strike.sources,
      dcSources: [...armorClass.sources, ...rearSources],
    },
  };
}

function checkNotes(check: ResolvedActionCheck, prefix: readonly string[] = []): readonly string[] {
  return [...prefix, ...formatStatisticSources(check.modifierSources), ...formatStatisticSources(check.dcSources)];
}

/**
 * The one place an Action turns into concrete numbers. `previewAction()` and the command
 * executor both call this before anything else happens, so a Card cannot own a private
 * calculator and a UI cannot re-derive modifiers of its own.
 */
export function buildResolvedActionPlan(
  definition: ActionDefinition,
  actor: ActorState,
  target: ActionTarget,
  source: ActionSource,
  state: Pick<CombatState, "actors">,
  content: CombatContent,
  mapContext: ActionMapContext,
): ResolvedActionPlan | null {
  const targetActor = target.kind === "actor" ? state.actors[target.actorId] : undefined;
  const participants: ActionParticipants = { actor, target: targetActor };
  const context: StatisticResolutionContext = { content };
  // An unmet requirement makes the plan unresolvable rather than producing numbers a UI
  // would then have to hide: legality, preview and execution all read the same null.
  if (!meetsActionRequirements(definition, actor, context)) return null;
  const attacksThisTurn = attacksForMap(mapContext, definition.traits.some((trait) => trait.id === "attack"));
  const base = {
    actionId: definition.id,
    actionActorId: actor.id,
    targetActorId: targetActor?.id,
    source,
    target,
    label: definition.name,
  };

  const resolution = definition.resolution;
  if (resolution.kind === "move") {
    return { ...base, resolution, notes: [`Face ${target.kind === "tile" ? target.facing : actor.facing} after moving.`] };
  }
  if (resolution.kind === "direct") {
    return { ...base, resolution, notes: [] };
  }
  if (resolution.kind === "strike") {
    const extraWeaponDice = resolution.extraWeaponDice ?? 0;
    const resolved = resolveStrikeCheck(participants, context, attacksThisTurn, extraWeaponDice);
    if (!resolved) return null;
    const extraDiceNote = extraWeaponDice > 0
      ? [`+${String(extraWeaponDice)}d${String(resolved.strike.damage.sides)} weapon damage`]
      : [];
    return {
      ...base,
      resolution: {
        kind: "strike",
        check: resolved.check,
        strike: resolved.strike,
        damageMultiplier: resolution.damageMultiplier,
        outcomes: resolution.outcomes,
      },
      notes: checkNotes(resolved.check, [resolved.strike.weaponName, ...extraDiceNote]),
    };
  }
  const check = resolveCheck(resolution.check, participants, context, resolveMapPenalty(attacksThisTurn));
  if (!check) return null;
  return {
    ...base,
    resolution: { kind: "check", check, outcomes: resolution.outcomes },
    notes: checkNotes(check),
  };
}

/** Reach for enemy targeting, read from the Action rather than from what it does. */
export function actionRangeFeet(
  definition: ActionDefinition,
  actor: ActorState,
  context: StatisticResolutionContext,
): number {
  const range = definition.range ?? { kind: "feet" as const, value: 5 };
  return range.kind === "weapon-reach" ? resolveStrike(actor, context).rangeFeet : range.value;
}
