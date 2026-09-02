import { equipmentTraits } from "./rules";
import { proficiencyBonus, resolveModifierStack, titleCase, type StatisticResolutionContext } from "./statistics";
import type {
  ActionMapContext,
  ActorState,
  AttributeId,
  CharacterStatProfile,
  CharacterWeaponProfile,
  EquipmentDefinition,
  FixedStrikeProfile,
  ProficiencyRank,
  ResolvedStrikeDamage,
  ResolvedStrikeProfile,
  StatisticSource,
  TraitId,
  TraitInstance,
  WeaponCategory,
} from "./types";

export const WEAPON_CATEGORIES = [
  "unarmed",
  "simple",
  "martial",
  "advanced",
] as const satisfies readonly WeaponCategory[];

const STANDARD_MAP = [0, -5, -10] as const;
const AGILE_MAP = [0, -4, -8] as const;

export interface StrikeResolutionOptions {
  /** Attacks already made this turn, before this one. The MAP ladder is derived from it. */
  readonly attacksThisTurn?: number;
  /**
   * Extra dice of the weapon's own base die, from an Action such as a heavy two-action
   * swing. Only the die count grows: the attack modifier and the Attribute damage
   * contribution are resolved once and never duplicated.
   */
  readonly extraWeaponDice?: number;
}

/**
 * Where a Strike's raw definition comes from. A Character carries a real weapon or falls
 * back to its authored unarmed Strike; a Creature always uses its authored fixed Strike
 * and is never pushed through the Character weapon-proficiency formula.
 */
export type StrikeSource =
  | {
      readonly kind: "equipment";
      readonly equipment: EquipmentDefinition;
      readonly profile: CharacterWeaponProfile;
      readonly traits: readonly TraitInstance[];
      readonly stats: CharacterStatProfile;
    }
  | {
      readonly kind: "unarmed";
      readonly profile: CharacterWeaponProfile;
      readonly traits: readonly TraitInstance[];
      readonly stats: CharacterStatProfile;
    }
  | { readonly kind: "fixed"; readonly profile: FixedStrikeProfile; readonly traits: readonly TraitInstance[] };

export function equippedWeapon(
  actor: Pick<ActorState, "equipmentIds">,
  context: StatisticResolutionContext,
): EquipmentDefinition | undefined {
  for (const equipmentId of [...actor.equipmentIds].sort()) {
    const equipment = context.content.equipment[equipmentId];
    if (equipment?.weaponProfile) return equipment;
  }
  return undefined;
}

export function resolveStrikeSource(actor: ActorState, context: StatisticResolutionContext): StrikeSource {
  if (actor.statProfile.kind === "creature") {
    const profile = actor.statProfile.stats.strike;
    return { kind: "fixed", profile, traits: profile.traits };
  }
  const stats = actor.statProfile.stats;
  const equipment = equippedWeapon(actor, context);
  if (equipment?.weaponProfile) {
    // Weapon Traits reuse the Equipment/Trait pipeline: `equipmentTraits()` is the same
    // effective set the card, action and modifier providers read.
    return {
      kind: "equipment",
      equipment,
      profile: equipment.weaponProfile,
      traits: equipmentTraits(equipment),
      stats,
    };
  }
  const unarmedStrike = stats.offense.unarmedStrike;
  return { kind: "unarmed", profile: unarmedStrike, traits: unarmedStrike.traits, stats };
}

/**
 * How many attacks the MAP ladder should count for this Action. PF2e applies MAP only
 * inside the actor's own turn sequence, so an off-turn Reaction resolves at no penalty —
 * the policy lives here rather than as a literal at a reaction executor call site.
 */
export function attacksForMap(context: ActionMapContext, hasAttackTrait: boolean): number {
  return context.kind === "turn" && hasAttackTrait ? context.attacksThisTurn : 0;
}

/**
 * PF2e's multiple attack penalty. `attacksThisTurn` stays Attack-trait driven, so an
 * Athletics Trip still counts toward it — but only a Strike made with an agile weapon
 * gets the eased -4/-8 ladder.
 */
export function resolveMapPenalty(attacksThisTurn: number, traits: readonly TraitId[] = []): number {
  const stage = Math.min(STANDARD_MAP.length - 1, Math.max(0, attacksThisTurn));
  return (traits.includes("agile") ? AGILE_MAP : STANDARD_MAP)[stage] as number;
}

/**
 * Melee uses STR and ranged uses DEX. A finesse melee weapon may legally use either, and
 * CardGuild does not prompt per attack: it picks the higher resolved attack modifier.
 * Proficiency, the modifier stack and MAP are identical across the candidates, so
 * comparing Attribute modifiers compares the resolved totals.
 */
function attackAttribute(
  profile: CharacterWeaponProfile,
  traits: readonly TraitId[],
  attributes: Readonly<Record<AttributeId, number>>,
): AttributeId {
  const candidates: readonly AttributeId[] = profile.attackMode === "ranged"
    ? ["dex"]
    : traits.includes("finesse")
      ? ["str", "dex"]
      : ["str"];
  return candidates.reduce((best, candidate) =>
    (attributes[candidate] > attributes[best] ? candidate : best));
}

/**
 * Melee and thrown Strikes add STR to damage; a plain ranged Strike adds nothing. A
 * propulsive ranged weapon adds half a positive STR modifier, or the full penalty when
 * STR is negative.
 */
function damageAttributeSource(
  profile: CharacterWeaponProfile,
  traits: readonly TraitId[],
  attributes: Readonly<Record<AttributeId, number>>,
): StatisticSource | null {
  const strength = attributes.str;
  if (profile.attackMode === "melee" || traits.includes("thrown")) {
    return { kind: "attribute", sourceId: "attribute:str", label: "STR", value: strength, applied: true };
  }
  if (traits.includes("propulsive")) {
    return {
      kind: "attribute",
      sourceId: "attribute:str",
      label: strength > 0 ? "STR (propulsive half)" : "STR (propulsive)",
      value: strength > 0 ? Math.floor(strength / 2) : strength,
      applied: true,
    };
  }
  return null;
}

function mapSources(mapPenalty: number, agile: boolean): readonly StatisticSource[] {
  return mapPenalty === 0
    ? []
    : [{
        kind: "map",
        sourceId: "multiple-attack-penalty",
        label: agile ? "Multiple attack penalty (agile)" : "Multiple attack penalty",
        value: mapPenalty,
        applied: true,
      }];
}

function total(sources: readonly StatisticSource[]): number {
  return sources.reduce((sum, source) => sum + (source.applied ? source.value : 0), 0);
}

/**
 * The single offense resolver. Legality queries, action previews, the Loadout preview,
 * normal Strike execution and Reactive Strike all call this instead of reading raw
 * weapon data, so no consumer re-implements attack, damage or MAP arithmetic.
 */
export function resolveStrike(
  actor: ActorState,
  context: StatisticResolutionContext,
  options: StrikeResolutionOptions = {},
): ResolvedStrikeProfile {
  const source = resolveStrikeSource(actor, context);
  const traits = [...new Set(source.traits.map((trait) => trait.id))].sort();
  const mapPenalty = resolveMapPenalty(options.attacksThisTurn ?? 0, traits);
  const extraDice = Math.max(0, options.extraWeaponDice ?? 0);
  const penaltySources = mapSources(mapPenalty, traits.includes("agile"));
  const attackStack = resolveModifierStack(actor, { kind: "attack" }, context);
  const damageStack = resolveModifierStack(actor, { kind: "damage" }, context);

  if (source.kind === "fixed") {
    const { profile } = source;
    const attackSources: readonly StatisticSource[] = [
      {
        kind: "fixed",
        sourceId: "creature:strike",
        label: `Authored ${profile.name}`,
        value: profile.attackModifier,
        applied: true,
      },
      ...attackStack,
      ...penaltySources,
    ];
    const damageSources: readonly StatisticSource[] = [
      {
        kind: "fixed",
        sourceId: "creature:strike:damage",
        label: "Authored damage",
        value: profile.damage.modifier,
        applied: true,
      },
      ...damageStack,
    ];
    return {
      weaponName: profile.name,
      weaponCategory: null,
      proficiencyRank: null,
      attackMode: null,
      attackAttribute: null,
      attackModifier: total(attackSources),
      mapPenalty,
      rangeFeet: profile.rangeFeet,
      traits,
      damage: damageStrike(profile.damage.count + extraDice, profile.damage.sides, profile.damage.damageType, damageSources),
      sources: attackSources,
    };
  }

  const { profile, stats: characterStats } = source;
  const rank: ProficiencyRank = characterStats.offense.weaponProficiencies[profile.category];
  const attribute = attackAttribute(profile, traits, characterStats.attributes);
  const attackSources: readonly StatisticSource[] = [
    {
      kind: "attribute",
      sourceId: `attribute:${attribute}`,
      label: attribute.toUpperCase(),
      value: characterStats.attributes[attribute],
      applied: true,
    },
    {
      kind: "proficiency",
      sourceId: `proficiency:${profile.category}:${rank}`,
      label: `${titleCase(rank)} ${profile.category} weapon proficiency`,
      value: proficiencyBonus(characterStats.level, rank),
      applied: true,
    },
    ...attackStack,
    ...penaltySources,
  ];
  const damageAttribute = damageAttributeSource(profile, traits, characterStats.attributes);
  const damageSources: readonly StatisticSource[] = [
    ...(damageAttribute ? [damageAttribute] : []),
    ...damageStack,
  ];
  return {
    weaponName: profile.name,
    weaponCategory: profile.category,
    proficiencyRank: rank,
    attackMode: profile.attackMode,
    attackAttribute: attribute,
    attackModifier: total(attackSources),
    mapPenalty,
    rangeFeet: profile.rangeFeet,
    traits,
    damage: damageStrike(profile.damage.count + extraDice, profile.damage.sides, profile.damage.damageType, damageSources),
    sources: attackSources,
  };
}

/**
 * PF2e Player Core: a Strike's damage roll deals at least 1 damage even when penalties
 * would take it to 0 or below (https://2e.aonprd.com/Rules.aspx?ID=2263). Resistance is a
 * later step and may still reduce this to 0; the roll itself never does.
 */
export function weaponDamageRoll(rolledDice: number, flatModifier: number): number {
  return Math.max(1, rolledDice + flatModifier);
}

/**
 * The one place a rolled damage total becomes a number, shared by Strikes and by authored
 * `damage` effects. The minimum applies to the normal damage first, and only then does a
 * multiplier scale it — a penalised critical deals 2, not 0.
 *
 * Multipliers below 1 exist for PF2e's basic save, where a successful save takes half
 * damage rounded down (https://2e.aonprd.com/Rules.aspx?ID=2296). Halving rounds down but
 * never erases damage that was there: scaling positive damage by a positive multiplier
 * still deals at least 1. Resistance is a later step and may take it to 0; this one never
 * does. Both rules live here rather than at any call site.
 */
export function damageTotal(rolledDice: number, flatModifier: number, multiplier: number): number {
  if (multiplier <= 0) return 0;
  return Math.max(1, Math.floor(weaponDamageRoll(rolledDice, flatModifier) * multiplier));
}

function damageStrike(
  count: number,
  sides: number,
  damageType: ResolvedStrikeDamage["damageType"],
  sources: readonly StatisticSource[],
): ResolvedStrikeDamage {
  return { count, sides, damageType, flatModifier: total(sources), sources };
}
