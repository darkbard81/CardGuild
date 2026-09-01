import { equipmentTraits } from "./rules";
import type {
  ActorStatProfile,
  ActorState,
  ArmorCategory,
  ArmorProfile,
  AttributeId,
  CharacterStatProfile,
  CharacterWeaponProfile,
  CombatContent,
  EquipmentDefinition,
  FixedCreatureStats,
  InitiativeStatisticSelector,
  ModifierTarget,
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
          defense: {
            ...profile.stats.defense,
            armorProficiencies: { ...profile.stats.defense.armorProficiencies },
          },
          offense: {
            ...profile.stats.offense,
            weaponProficiencies: { ...profile.stats.offense.weaponProficiencies },
            unarmedStrike: cloneCharacterWeaponProfile(profile.stats.offense.unarmedStrike),
          },
        },
      }
    : {
        kind: "creature",
        stats: {
          ...profile.stats,
          saves: { ...profile.stats.saves },
          skills: { ...profile.stats.skills },
          strike: {
            ...profile.stats.strike,
            damage: { ...profile.stats.strike.damage },
            traits: profile.stats.strike.traits.map((trait) => ({ ...trait })),
          },
        },
      };
}

function cloneCharacterWeaponProfile(profile: CharacterWeaponProfile): CharacterWeaponProfile {
  return {
    ...profile,
    damage: { ...profile.damage },
    traits: profile.traits.map((trait) => ({ ...trait })),
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
export const ARMOR_CATEGORIES = ["unarmored", "light", "medium", "heavy"] as const satisfies readonly ArmorCategory[];
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

export function titleCase(value: string): string {
  return `${value[0]?.toUpperCase() ?? ""}${value.slice(1)}`;
}

function selectorLabel(selector: StatisticSelector): string {
  if (selector.kind === "perception") return "Perception";
  return titleCase(selector.id);
}

/**
 * `all` reaches every check and DC the stack serves — AC, attack rolls and Class DC
 * included — which is what makes one authored Frightened contribution hit all of them.
 * It deliberately stops at damage: damage is not a check, and a status penalty to
 * checks and DCs never reduces the damage a Strike deals.
 */
function selectorMatches(contribution: StatisticModifierContribution, target: ModifierTarget): boolean {
  if (contribution.selector.kind === "all") return target.kind !== "damage";
  if (contribution.selector.kind === "perception") return target.kind === "perception";
  if (contribution.selector.kind === "ac") return target.kind === "ac";
  if (contribution.selector.kind === "attack") return target.kind === "attack";
  if (contribution.selector.kind === "damage") return target.kind === "damage";
  if (contribution.selector.kind === "class-dc") return target.kind === "class-dc";
  if (contribution.selector.kind === "save" && target.kind === "save") {
    return contribution.selector.id === undefined || contribution.selector.id === target.id;
  }
  if (contribution.selector.kind === "skill" && target.kind === "skill") {
    return contribution.selector.id === undefined || contribution.selector.id === target.id;
  }
  return false;
}

function modifierTarget(selector: StatisticSelector): ModifierTarget {
  return selector.kind === "skill" ? { kind: "skill", id: selector.id } : selector;
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

export function isUntypedPenalty(modifier: Pick<StatisticModifierContribution, "type" | "value">): boolean {
  return modifier.type !== "untyped" || modifier.value < 0;
}

function assertUntypedIsPenalty(modifier: SourcedModifier): void {
  // PF2e Remaster has no untyped bonus: every untyped contribution is a penalty and they all stack.
  if (isUntypedPenalty(modifier)) return;
  throw new Error(
    `Untyped modifier "${modifier.label}" from ${modifier.sourceKind} "${modifier.sourceId}" must be a penalty ` +
    `(value < 0) but is ${modifier.value}.`,
  );
}

/**
 * Armor and a raised Shield reach AC as ordinary typed contributions instead of
 * special-case arithmetic, so they stack under the same rules as everything else.
 *
 * The armor item bonus is one term of the Character formula (capped DEX + armor
 * proficiency + item bonus), so it is only derived for Characters: a Creature's
 * authored AC is a complete top-down value and must not absorb half a bottom-up
 * derivation. A shield bonus counts only from the shield slot it is authored for.
 */
function derivedEquipmentModifiers(
  equipment: EquipmentDefinition,
  actor: Pick<ActorState, "shieldRaised" | "statProfile">,
): readonly StatisticModifierContribution[] {
  const derived: StatisticModifierContribution[] = [];
  if (
    actor.statProfile.kind === "character" &&
    equipment.armorProfile &&
    equipment.armorProfile.acItemBonus !== 0
  ) {
    derived.push({
      selector: { kind: "ac" },
      type: "item",
      value: equipment.armorProfile.acItemBonus,
      label: equipment.name,
    });
  }
  if (equipment.slot === "shield" && equipment.shieldBonus && actor.shieldRaised) {
    derived.push({
      selector: { kind: "ac" },
      type: "circumstance",
      value: equipment.shieldBonus,
      label: `${equipment.name} raised`,
    });
  }
  return derived;
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
      ...sourced(derivedEquipmentModifiers(equipment, actor), "equipment", equipment.id),
      ...traitModifiers(equipmentTraits(equipment), context, `equipment:${equipment.id}`),
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
  for (const modifier of modifiers) assertUntypedIsPenalty(modifier);
  return modifiers.sort((left, right) =>
    SOURCE_KIND_ORDER[left.sourceKind] - SOURCE_KIND_ORDER[right.sourceKind] ||
    left.sourceId.localeCompare(right.sourceId) ||
    left.type.localeCompare(right.type) ||
    left.label.localeCompare(right.label) ||
    left.value - right.value);
}

function creatureBaseSource(stats: FixedCreatureStats, selector: StatisticSelector): StatisticSource {
  const authored = selector.kind === "perception"
    ? stats.perception
    : selector.kind === "save"
      ? stats.saves[selector.id]
      : stats.skills[selector.id];
  // Creatures may author statistics partially. An unlisted Skill defaults to +0 but keeps a
  // provenance label distinct from an explicitly authored 0 so debug output stays honest.
  return authored === undefined
    ? {
        kind: "fixed",
        sourceId: `creature:${selectorKey(selector)}:unlisted`,
        label: `Unlisted ${selectorLabel(selector)}`,
        value: 0,
        applied: true,
      }
    : {
        kind: "fixed",
        sourceId: `creature:${selectorKey(selector)}`,
        label: `Authored ${selectorLabel(selector)}`,
        value: authored,
        applied: true,
      };
}

function baseSources(actor: ActorState, selector: StatisticSelector): readonly StatisticSource[] {
  if (actor.statProfile.kind === "creature") {
    return [creatureBaseSource(actor.statProfile.stats, selector)];
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
      label: `${titleCase(rank)} proficiency`,
      value: proficiencyBonus(profile.level, rank),
      applied: true,
    },
  ];
}

function selectedTypedIndices(modifiers: readonly SourcedModifier[]): ReadonlySet<number> {
  const selected = new Set<number>();
  const typed = ["circumstance", "item", "status"] as const satisfies readonly ModifierType[];
  modifiers.forEach((modifier, index) => {
    if (modifier.type === "untyped") selected.add(index); // every untyped penalty stacks
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

/**
 * Equipment / Condition / Trait / Context contributions for one target, in deterministic
 * order, each flagged with whether PF2e stacking selects it. Every statistic resolver
 * shares this so bonus/penalty stacking is never re-implemented per statistic.
 */
export function resolveModifierStack(
  actor: ActorState,
  target: ModifierTarget,
  context: StatisticResolutionContext,
): readonly StatisticSource[] {
  const modifiers = collectModifiers(actor, context).filter((modifier) => selectorMatches(modifier, target));
  const selected = selectedTypedIndices(modifiers);
  return modifiers.map((modifier, index) => ({
    kind: modifier.sourceKind,
    sourceId: modifier.sourceId,
    label: modifier.label,
    value: modifier.value,
    modifierType: modifier.type,
    applied: selected.has(index),
  }));
}

/** Sums the applied sources of a base derivation and its modifier stack into one result. */
export function combineStatisticSources(
  ...groups: readonly (readonly StatisticSource[])[]
): ResolvedStatistic {
  const sources = groups.flat();
  return {
    value: sources.reduce((total, source) => total + (source.applied ? source.value : 0), 0),
    sources,
  };
}

export function resolveStatisticModifier(
  actor: ActorState,
  selector: StatisticSelector,
  context: StatisticResolutionContext,
): ResolvedStatistic {
  return combineStatisticSources(
    baseSources(actor, selector),
    resolveModifierStack(actor, modifierTarget(selector), context),
  );
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
  source: InitiativeStatisticSelector = { kind: "perception" },
): ResolvedStatistic {
  return resolveStatisticModifier(actor, source, context);
}

export function equippedArmor(
  actor: Pick<ActorState, "equipmentIds">,
  context: StatisticResolutionContext,
): EquipmentDefinition | undefined {
  for (const equipmentId of [...actor.equipmentIds].sort()) {
    const equipment = context.content.equipment[equipmentId];
    if (equipment?.armorProfile) return equipment;
  }
  return undefined;
}

export function effectiveDexterity(dexterity: number, armor: ArmorProfile | undefined): number {
  return armor ? Math.min(dexterity, armor.dexCap) : dexterity;
}

function armorClassBaseSources(
  actor: ActorState,
  context: StatisticResolutionContext,
): readonly StatisticSource[] {
  if (actor.statProfile.kind === "creature") {
    return [{
      kind: "fixed",
      sourceId: "creature:ac",
      label: "Authored AC",
      value: actor.statProfile.stats.ac,
      applied: true,
    }];
  }

  const profile = actor.statProfile.stats;
  const armor = equippedArmor(actor, context)?.armorProfile;
  const category: ArmorCategory = armor?.category ?? "unarmored";
  const dexterity = profile.attributes.dex;
  const capped = effectiveDexterity(dexterity, armor);
  const rank = profile.defense.armorProficiencies[category];
  return [
    { kind: "dc", sourceId: "ac-base", label: "Base AC", value: 10, applied: true },
    {
      kind: "attribute",
      sourceId: "attribute:dex",
      label: armor && capped < dexterity ? `DEX (cap ${armor.dexCap})` : "DEX",
      value: capped,
      applied: true,
    },
    {
      kind: "proficiency",
      sourceId: `proficiency:${category}:${rank}`,
      label: `${titleCase(rank)} ${category} armor proficiency`,
      value: proficiencyBonus(profile.level, rank),
      applied: true,
    },
  ];
}

/**
 * `10 + capped DEX + armor proficiency` for Characters, authored AC for Creatures, both
 * finished by the shared typed modifier stack. Nothing caches a final AC.
 */
export function resolveArmorClass(
  actor: ActorState,
  context: StatisticResolutionContext,
): ResolvedStatistic {
  return combineStatisticSources(
    armorClassBaseSources(actor, context),
    resolveModifierStack(actor, { kind: "ac" }, context),
  );
}

export function deriveMaxHp(profile: CharacterStatProfile): number {
  const { ancestryHp, classHpPerLevel } = profile.defense;
  if (!Number.isInteger(profile.level) || profile.level < 1) {
    throw new Error("Character level must be a positive integer to derive maximum HP.");
  }
  return ancestryHp + profile.level * (classHpPerLevel + profile.attributes.con);
}

export function resolveMaxHp(profile: ActorStatProfile): number {
  return profile.kind === "creature" ? profile.stats.maxHp : deriveMaxHp(profile.stats);
}

/**
 * `10 + Key Attribute + Class DC proficiency`, finished by the shared modifier stack.
 * Deliberately distinct from Save DCs, Skill DCs and any future Spell DC: no single
 * conflated "power DC" number exists.
 */
export function resolveClassDC(
  actor: ActorState,
  context: StatisticResolutionContext,
): ResolvedStatistic {
  if (actor.statProfile.kind !== "character") {
    throw new Error(`Class DC is a Character statistic, but actor "${actor.id}" uses a creature profile.`);
  }
  const profile = actor.statProfile.stats;
  const { keyAttribute, classDcProficiency } = profile.offense;
  return combineStatisticSources(
    [
      { kind: "dc", sourceId: "class-dc-base", label: "DC base", value: 10, applied: true },
      {
        kind: "attribute",
        sourceId: `attribute:${keyAttribute}`,
        label: `${keyAttribute.toUpperCase()} (key)`,
        value: profile.attributes[keyAttribute],
        applied: true,
      },
      {
        kind: "proficiency",
        sourceId: `proficiency:class-dc:${classDcProficiency}`,
        label: `${titleCase(classDcProficiency)} class DC proficiency`,
        value: proficiencyBonus(profile.level, classDcProficiency),
        applied: true,
      },
    ],
    resolveModifierStack(actor, { kind: "class-dc" }, context),
  );
}

export function formatStatisticSources(sources: readonly StatisticSource[]): readonly string[] {
  return sources
    .filter((source) => source.applied)
    .map((source) => `${source.label} ${source.value >= 0 ? "+" : ""}${source.value}`);
}
