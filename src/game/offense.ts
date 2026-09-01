import { proficiencyBonus, resolveModifierStack, titleCase, type StatisticResolutionContext } from "./statistics";
import type {
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

function mergeTraits(...groups: readonly (readonly TraitInstance[])[]): readonly TraitInstance[] {
  const seen = new Set<TraitId>();
  return groups.flat().filter((trait) => {
    if (seen.has(trait.id)) return false;
    seen.add(trait.id);
    return true;
  });
}

export function resolveStrikeSource(actor: ActorState, context: StatisticResolutionContext): StrikeSource {
  if (actor.statProfile.kind === "creature") {
    const profile = actor.statProfile.stats.strike;
    return { kind: "fixed", profile, traits: profile.traits };
  }
  const stats = actor.statProfile.stats;
  const equipment = equippedWeapon(actor, context);
  if (equipment?.weaponProfile) {
    // Weapon traits reuse the Equipment/Trait pipeline; the profile may name extra ones
    // instead of growing a boolean per trait.
    return {
      kind: "equipment",
      equipment,
      profile: equipment.weaponProfile,
      traits: mergeTraits(equipment.traits, equipment.weaponProfile.traits),
      stats,
    };
  }
  const unarmedStrike = stats.offense.unarmedStrike;
  return { kind: "unarmed", profile: unarmedStrike, traits: unarmedStrike.traits, stats };
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
      damage: damageStrike(profile.damage.count, profile.damage.sides, profile.damage.damageType, damageSources),
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
    damage: damageStrike(profile.damage.count, profile.damage.sides, profile.damage.damageType, damageSources),
    sources: attackSources,
  };
}

function damageStrike(
  count: number,
  sides: number,
  damageType: ResolvedStrikeDamage["damageType"],
  sources: readonly StatisticSource[],
): ResolvedStrikeDamage {
  return { count, sides, damageType, flatModifier: total(sources), sources };
}
