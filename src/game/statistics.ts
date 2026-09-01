import type {
  ActorStatProfile,
  ActorState,
  AttributeId,
  CombatContent,
  ModifierType,
  ProficiencyRank,
  ResolvedStatistic,
  SaveId,
  SkillId,
  StatisticContextModifier,
  StatisticModifierContribution,
  StatisticSelector,
  StatisticSource,
  StatisticSourceKind,
  TraitInstance,
} from "./types";

export function cloneActorStatProfile(profile: ActorStatProfile): ActorStatProfile {
  return profile.kind === "character"
    ? {
        kind: "character",
        stats: {
          ...profile.stats,
          attributes: { ...profile.stats.attributes },
          saves: { ...profile.stats.saves },
          skills: { ...profile.stats.skills },
        },
      }
    : {
        kind: "creature",
        stats: {
          ...profile.stats,
          saves: { ...profile.stats.saves },
          skills: { ...profile.stats.skills },
        },
      };
}

export const SAVE_ATTRIBUTE: Readonly<Record<SaveId, AttributeId>> = {
  fortitude: "con",
  reflex: "dex",
  will: "wis",
};

export const SKILL_ATTRIBUTE: Readonly<Record<SkillId, AttributeId>> = {
  acrobatics: "dex",
  arcana: "int",
  athletics: "str",
  crafting: "int",
  deception: "cha",
  diplomacy: "cha",
  intimidation: "cha",
  medicine: "wis",
  nature: "wis",
  occultism: "int",
  performance: "cha",
  religion: "wis",
  society: "int",
  stealth: "dex",
  survival: "wis",
  thievery: "dex",
};

export const ATTRIBUTE_IDS = ["str", "dex", "con", "int", "wis", "cha"] as const satisfies readonly AttributeId[];
export const SAVE_IDS = ["fortitude", "reflex", "will"] as const satisfies readonly SaveId[];
export const SKILL_IDS = [
  "acrobatics",
  "arcana",
  "athletics",
  "crafting",
  "deception",
  "diplomacy",
  "intimidation",
  "medicine",
  "nature",
  "occultism",
  "performance",
  "religion",
  "society",
  "stealth",
  "survival",
  "thievery",
] as const satisfies readonly SkillId[];

export interface StatisticResolutionContext {
  readonly content: Pick<CombatContent, "conditions" | "equipment" | "traits">;
  readonly modifiers?: readonly StatisticContextModifier[];
}

interface SourcedModifier extends StatisticModifierContribution {
  readonly sourceKind: Extract<StatisticSourceKind, "equipment" | "condition" | "trait" | "context">;
  readonly sourceId: string;
}

const SOURCE_KIND_ORDER: Readonly<Record<SourcedModifier["sourceKind"], number>> = {
  equipment: 0,
  condition: 1,
  trait: 2,
  context: 3,
};

export function proficiencyBonus(level: number, rank: ProficiencyRank): number {
  if (!Number.isInteger(level) || level < 0) throw new Error("Character level must be a non-negative integer.");
  switch (rank) {
    case "untrained":
      return 0;
    case "trained":
      return level + 2;
    case "expert":
      return level + 4;
    case "master":
      return level + 6;
    case "legendary":
      return level + 8;
  }
}

function selectorKey(selector: StatisticSelector): string {
  if (selector.kind === "perception") return "perception";
  return `${selector.kind}:${selector.id}`;
}

function selectorLabel(selector: StatisticSelector): string {
  if (selector.kind === "perception") return "Perception";
  return selector.id[0]?.toUpperCase() + selector.id.slice(1);
}

function selectorMatches(contribution: StatisticModifierContribution, selector: StatisticSelector): boolean {
  if (contribution.selector.kind === "all") return true;
  if (contribution.selector.kind === "perception") return selector.kind === "perception";
  if (contribution.selector.kind === "save" && selector.kind === "save") {
    return contribution.selector.id === undefined || contribution.selector.id === selector.id;
  }
  if (contribution.selector.kind === "skill" && selector.kind === "skill") {
    return contribution.selector.id === undefined || contribution.selector.id === selector.id;
  }
  return false;
}

function sourced(
  contributions: readonly StatisticModifierContribution[] | undefined,
  sourceKind: SourcedModifier["sourceKind"],
  sourceId: string,
): readonly SourcedModifier[] {
  return (contributions ?? []).map((contribution) => ({ ...contribution, sourceKind, sourceId }));
}

function traitModifiers(
  traits: readonly TraitInstance[],
  context: StatisticResolutionContext,
  sourceId: string,
): readonly SourcedModifier[] {
  return [...traits]
    .sort((left, right) => left.id.localeCompare(right.id) || (left.sourceId ?? "").localeCompare(right.sourceId ?? ""))
    .flatMap((trait) => sourced(
      context.content.traits[trait.id]?.statModifiers,
      "trait",
      `${sourceId}:trait:${trait.id}:${trait.sourceId ?? ""}`,
    ));
}

function collectModifiers(actor: ActorState, context: StatisticResolutionContext): readonly SourcedModifier[] {
  const modifiers: SourcedModifier[] = [
    ...traitModifiers(actor.traits, context, `actor:${actor.id}`),
  ];
  for (const equipmentId of [...actor.equipmentIds].sort()) {
    const equipment = context.content.equipment[equipmentId];
    if (!equipment) continue;
    modifiers.push(
      ...sourced(equipment.statModifiers, "equipment", equipment.id),
      ...traitModifiers(equipment.traits, context, `equipment:${equipment.id}`),
    );
  }
  for (const condition of [...actor.conditions]
    .sort((left, right) => left.id.localeCompare(right.id) || left.sourceId.localeCompare(right.sourceId))) {
    const definition = context.content.conditions[condition.id];
    if (!definition) continue;
    modifiers.push(
      ...sourced(definition.statModifiers, "condition", `${condition.id}:${condition.sourceId}`),
      ...traitModifiers(definition.traits, context, `condition:${condition.id}:${condition.sourceId}`),
    );
  }
  modifiers.push(...(context.modifiers ?? []).map(({ sourceId, ...modifier }) => ({
    ...modifier,
    sourceKind: "context" as const,
    sourceId,
  })));
  return modifiers.sort((left, right) =>
    SOURCE_KIND_ORDER[left.sourceKind] - SOURCE_KIND_ORDER[right.sourceKind] ||
    left.sourceId.localeCompare(right.sourceId) ||
    left.type.localeCompare(right.type) ||
    left.label.localeCompare(right.label) ||
    left.value - right.value);
}

function baseSources(actor: ActorState, selector: StatisticSelector): readonly StatisticSource[] {
  if (actor.statProfile.kind === "creature") {
    const fixed = selector.kind === "perception"
      ? actor.statProfile.stats.perception
      : selector.kind === "save"
        ? actor.statProfile.stats.saves[selector.id]
        : actor.statProfile.stats.skills[selector.id] ?? 0;
    return [{
      kind: "fixed",
      sourceId: `creature:${selectorKey(selector)}`,
      label: `Authored ${selectorLabel(selector)}`,
      value: fixed,
      applied: true,
    }];
  }

  const profile = actor.statProfile.stats;
  const attributeId = selector.kind === "perception"
    ? "wis"
    : selector.kind === "save"
      ? SAVE_ATTRIBUTE[selector.id]
      : selector.attributeOverride ?? SKILL_ATTRIBUTE[selector.id];
  const rank = selector.kind === "perception"
    ? profile.perception
    : selector.kind === "save"
      ? profile.saves[selector.id]
      : profile.skills[selector.id];
  return [
    {
      kind: "attribute",
      sourceId: `attribute:${attributeId}`,
      label: attributeId.toUpperCase(),
      value: profile.attributes[attributeId],
      applied: true,
    },
    {
      kind: "proficiency",
      sourceId: `proficiency:${rank}`,
      label: `${rank[0]?.toUpperCase()}${rank.slice(1)} proficiency`,
      value: proficiencyBonus(profile.level, rank),
      applied: true,
    },
  ];
}

function selectedTypedIndices(modifiers: readonly SourcedModifier[]): ReadonlySet<number> {
  const selected = new Set<number>();
  const typed = ["circumstance", "item", "status"] as const satisfies readonly ModifierType[];
  modifiers.forEach((modifier, index) => {
    if (modifier.type === "untyped") selected.add(index);
  });
  for (const type of typed) {
    let bonusIndex: number | null = null;
    let penaltyIndex: number | null = null;
    modifiers.forEach((modifier, index) => {
      if (modifier.type !== type) return;
      if (modifier.value > 0 && (bonusIndex === null || modifier.value > (modifiers[bonusIndex]?.value ?? 0))) {
        bonusIndex = index;
      }
      if (modifier.value < 0 && (penaltyIndex === null || modifier.value < (modifiers[penaltyIndex]?.value ?? 0))) {
        penaltyIndex = index;
      }
    });
    if (bonusIndex !== null) selected.add(bonusIndex);
    if (penaltyIndex !== null) selected.add(penaltyIndex);
  }
  return selected;
}

export function resolveStatisticModifier(
  actor: ActorState,
  selector: StatisticSelector,
  context: StatisticResolutionContext,
): ResolvedStatistic {
  const base = baseSources(actor, selector);
  const modifiers = collectModifiers(actor, context).filter((modifier) => selectorMatches(modifier, selector));
  const selected = selectedTypedIndices(modifiers);
  const sources: StatisticSource[] = [
    ...base,
    ...modifiers.map((modifier, index) => ({
      kind: modifier.sourceKind,
      sourceId: modifier.sourceId,
      label: modifier.label,
      value: modifier.value,
      modifierType: modifier.type,
      applied: selected.has(index),
    })),
  ];
  return {
    value: sources.reduce((total, source) => total + (source.applied ? source.value : 0), 0),
    sources,
  };
}

export function resolveStatisticDC(
  actor: ActorState,
  selector: StatisticSelector,
  context: StatisticResolutionContext,
): ResolvedStatistic {
  const modifier = resolveStatisticModifier(actor, selector, context);
  return {
    value: 10 + modifier.value,
    sources: [
      ...modifier.sources,
      { kind: "dc", sourceId: "dc-base", label: "DC base", value: 10, applied: true },
    ],
  };
}

export function resolveInitiative(
  actor: ActorState,
  context: StatisticResolutionContext,
  source: StatisticSelector = { kind: "perception" },
): ResolvedStatistic {
  return resolveStatisticModifier(actor, source, context);
}

export function formatStatisticSources(sources: readonly StatisticSource[]): readonly string[] {
  return sources
    .filter((source) => source.applied)
    .map((source) => `${source.label} ${source.value >= 0 ? "+" : ""}${source.value}`);
}
