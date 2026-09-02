import { positionKey } from "../game/grid";
import { ATTRIBUTE_IDS, SAVE_IDS, SKILL_IDS, deriveMaxHp, isUntypedPenalty } from "../game/statistics";
import type {
  ActionCheckDefinition,
  ActionDefinition,
  ActionOutcomeEffect,
  ActionResolution,
  ActionStatisticRef,
  ActionTargeting,
  CharacterWeaponProfile,
  ConditionDefinition,
  ConditionId,
  FixedStrikeProfile,
  StatisticModifierContribution,
  TraitInstance,
} from "../game/types";
import type {
  ContentPackSource,
  ContentSourceCategory,
  ContentSourceLocations,
  ContentValidationIssue,
} from "./content-types";

interface ValidationContext {
  readonly source: ContentPackSource;
  readonly locations: ContentSourceLocations;
  readonly issues: ContentValidationIssue[];
}

/** Targeting values that name another Actor, so a target-side check or effect has a subject. */
const ACTOR_TARGETING: readonly ActionTargeting[] = ["enemy", "ally", "creature"];

/** Which targeting a resolution can legally pair with, replacing the old 1:1 effect table. */
const RESOLUTION_TARGETING: Readonly<Record<ActionResolution["kind"], readonly ActionTargeting[]>> = {
  move: ["tile"],
  strike: ["enemy"],
  check: ["enemy", "ally", "creature", "self"],
  direct: ["none", "self", "ally", "creature", "enemy", "object", "effect"],
};

/** Targeting each effect primitive needs in order to have something to act on. */
const EFFECT_TARGETING: Readonly<Partial<Record<ActionOutcomeEffect["kind"], ActionTargeting>>> = {
  interact: "object",
  "sustain-effect": "effect",
};

const DEGREES = ["critical-success", "success", "failure", "critical-failure"] as const;

function sourcePath(context: ValidationContext, category: ContentSourceCategory): string {
  return context.locations[category] ?? category;
}

function addIssue(
  context: ValidationContext,
  category: ContentSourceCategory,
  path: string,
  code: string,
  message: string,
  definitionId?: string,
): void {
  context.issues.push({
    packId: context.source.manifest.id,
    source: sourcePath(context, category),
    path,
    definitionId,
    code,
    message,
  });
}

function validateUniqueIds<T extends { readonly id: string }>(
  context: ValidationContext,
  category: Exclude<ContentSourceCategory, "manifest">,
  values: readonly T[],
): void {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    if (value.id.trim().length === 0) {
      addIssue(context, category, `[${index}].id`, "EMPTY_ID", "Definition ID cannot be empty.");
    } else if (seen.has(value.id)) {
      addIssue(context, category, `[${index}].id`, "DUPLICATE_ID", `Duplicate ${category} ID "${value.id}".`, value.id);
    }
    seen.add(value.id);
  });
}

function validateTraits(
  context: ValidationContext,
  knownTraits: ReadonlySet<string>,
  category: ContentSourceCategory,
  definitionId: string,
  path: string,
  traits: readonly TraitInstance[],
): void {
  traits.forEach((trait, index) => {
    if (!knownTraits.has(trait.id)) {
      addIssue(
        context,
        category,
        `${path}[${index}].id`,
        "UNKNOWN_TRAIT",
        `Trait "${trait.id}" is not defined.`,
        definitionId,
      );
    }
  });
}

function validateStatModifiers(
  context: ValidationContext,
  category: "traits" | "conditions" | "equipment",
  definitionId: string,
  path: string,
  modifiers: readonly StatisticModifierContribution[] | undefined,
): void {
  (modifiers ?? []).forEach((modifier, index) => {
    if (!isUntypedPenalty(modifier)) {
      addIssue(
        context,
        category,
        `${path}[${index}].value`,
        "UNTYPED_MODIFIER_MUST_BE_PENALTY",
        `Untyped modifier "${modifier.label}" must be a penalty (value < 0) but is ${modifier.value}.`,
        definitionId,
      );
    }
  });
}

function validateConditionReference(
  context: ValidationContext,
  knownConditions: ReadonlySet<ConditionId>,
  action: ActionDefinition,
  condition: ConditionId,
  path: string,
): void {
  if (!knownConditions.has(condition)) {
    addIssue(
      context,
      "actions",
      path,
      "UNKNOWN_CONDITION",
      `Condition "${condition}" is not defined.`,
      action.id,
    );
  }
}

function validateStrikeShape(
  context: ValidationContext,
  category: "equipment" | "actors",
  definitionId: string,
  path: string,
  strike: CharacterWeaponProfile | FixedStrikeProfile,
  knownTraits: ReadonlySet<string>,
): void {
  if (!Number.isInteger(strike.rangeFeet) || strike.rangeFeet <= 0 || strike.rangeFeet % 5 !== 0) {
    addIssue(context, category, `${path}.rangeFeet`, "INVALID_WEAPON_RANGE", "Weapon range must be a positive multiple of 5 feet.", definitionId);
  }
  if (!Number.isInteger(strike.damage.count) || strike.damage.count < 1 || !Number.isInteger(strike.damage.sides) || strike.damage.sides < 2) {
    addIssue(context, category, `${path}.damage`, "INVALID_DAMAGE_DICE", "Weapon damage dice must have a positive count and at least 2 sides.", definitionId);
  }
  validateTraits(context, knownTraits, category, definitionId, `${path}.traits`, strike.traits);
}

function hasAttackTrait(definition: ActionDefinition): boolean {
  return definition.traits.some((trait) => trait.id === "attack");
}

function statisticRefIssue(statistic: ActionStatisticRef): string | null {
  if (statistic.kind === "skill") {
    if (!SKILL_IDS.includes(statistic.skill)) return `Skill "${statistic.skill}" is not a known skill.`;
    if (statistic.attributeOverride && !ATTRIBUTE_IDS.includes(statistic.attributeOverride)) {
      return `Attribute "${statistic.attributeOverride}" is not a known attribute.`;
    }
    return null;
  }
  if (statistic.kind === "save" && !SAVE_IDS.includes(statistic.save)) {
    return `Save "${statistic.save}" is not a known save.`;
  }
  return null;
}

function validateActionCheck(
  context: ValidationContext,
  definition: ActionDefinition,
  path: string,
  check: ActionCheckDefinition,
): void {
  const statisticIssue = statisticRefIssue(check.statistic);
  if (statisticIssue) {
    addIssue(context, "actions", `${path}.statistic`, "INVALID_STATISTIC_REF", statisticIssue, definition.id);
  }
  // A check that reads the target — as roller or as DC owner — needs an enemy to read.
  const needsTarget = check.roller === "target" || (check.dc.kind !== "fixed" && check.dc.owner === "target");
  if (needsTarget && !ACTOR_TARGETING.includes(definition.targeting)) {
    addIssue(context, "actions", `${path}`, "CHECK_REQUIRES_TARGET", `Action "${definition.id}" reads the target but does not target an Actor.`, definition.id);
  }
  if (check.dc.kind === "fixed" && (!Number.isInteger(check.dc.value) || check.dc.value <= 0)) {
    addIssue(context, "actions", `${path}.dc.value`, "INVALID_FIXED_DC", "A fixed DC must be a positive integer.", definition.id);
  }
  if (check.dc.kind === "statistic-dc") {
    const dcIssue = statisticRefIssue(check.dc.statistic);
    if (dcIssue) addIssue(context, "actions", `${path}.dc.statistic`, "INVALID_STATISTIC_REF", dcIssue, definition.id);
  }
}

/**
 * The one place an authored Condition value is checked. Both authoring paths — an
 * `apply-condition` outcome and an Actor's `initialConditions` — run through this, so a
 * value can never reach the runtime modifier stack without a policy that bounds it.
 */
function validateConditionValue(
  context: ValidationContext,
  category: ContentSourceCategory,
  conditionsById: ReadonlyMap<ConditionId, ConditionDefinition>,
  definitionId: string,
  path: string,
  condition: ConditionId,
  value: number | undefined,
): void {
  if (value === undefined) return;
  const policy = conditionsById.get(condition)?.valuePolicy;
  if (!policy) {
    addIssue(context, category, path, "CONDITION_VALUE_NOT_SUPPORTED", `Condition "${condition}" does not declare a valuePolicy.`, definitionId);
    return;
  }
  // `policy.min` is the value at which the Condition is gone, so authoring it would
  // describe a Condition that is not there — the runtime drops such an application.
  const lowest = policy.min + 1;
  if (value < lowest || value > policy.max) {
    addIssue(context, category, path, "CONDITION_VALUE_OUT_OF_RANGE", `Condition "${condition}" allows ${String(lowest)}–${String(policy.max)}, not ${String(value)}.`, definitionId);
  }
}

function validateOutcomeEffect(
  context: ValidationContext,
  knownConditions: ReadonlySet<ConditionId>,
  conditionsById: ReadonlyMap<ConditionId, ConditionDefinition>,
  knownActions: ReadonlySet<string>,
  definition: ActionDefinition,
  path: string,
  effect: ActionOutcomeEffect,
): void {
  if (effect.kind === "apply-condition" || effect.kind === "remove-condition") {
    validateConditionReference(context, knownConditions, definition, effect.condition, `${path}.condition`);
    if (effect.owner === "target" && !ACTOR_TARGETING.includes(definition.targeting)) {
      addIssue(context, "actions", `${path}.owner`, "EFFECT_REQUIRES_TARGET", `Action "${definition.id}" affects the target but does not target an Actor.`, definition.id);
    }
  }
  if (effect.kind === "apply-condition") {
    validateConditionValue(context, "actions", conditionsById, definition.id, `${path}.value`, effect.condition, effect.value);
  }
  if (effect.kind === "restore-hp") {
    if (effect.dice.count > 0 && effect.dice.sides < 2) {
      addIssue(context, "actions", `${path}.dice`, "INVALID_RESTORE_DICE", "Restore dice must have at least 2 sides.", definition.id);
    }
    if (effect.dice.count === 0 && effect.flatModifier <= 0) {
      addIssue(context, "actions", `${path}`, "INVALID_RESTORE_AMOUNT", "A restore-hp effect must roll dice or carry a positive flat amount.", definition.id);
    }
    if (effect.owner === "target" && !ACTOR_TARGETING.includes(definition.targeting)) {
      addIssue(context, "actions", `${path}.owner`, "EFFECT_REQUIRES_TARGET", `Action "${definition.id}" heals the target but does not target an Actor.`, definition.id);
    }
  }
  if (effect.kind === "lock-action" && !knownActions.has(effect.actionId)) {
    addIssue(context, "actions", `${path}.actionId`, "UNKNOWN_ACTION", `Action "${effect.actionId}" is not defined.`, definition.id);
  }
  if (effect.kind === "damage") {
    if (!Number.isInteger(effect.dice.count) || effect.dice.count < 1 || !Number.isInteger(effect.dice.sides) || effect.dice.sides < 2) {
      addIssue(context, "actions", `${path}.dice`, "INVALID_DAMAGE_DICE", "Damage dice must have a positive count and at least 2 sides.", definition.id);
    }
    if (effect.owner === "target" && !ACTOR_TARGETING.includes(definition.targeting)) {
      addIssue(context, "actions", `${path}.owner`, "EFFECT_REQUIRES_TARGET", `Action "${definition.id}" damages the target but does not target an Actor.`, definition.id);
    }
  }
  const requiredTargeting = EFFECT_TARGETING[effect.kind];
  if (requiredTargeting && definition.targeting !== requiredTargeting) {
    addIssue(context, "actions", `${path}`, "INCOMPATIBLE_TARGETING", `Effect "${effect.kind}" requires targeting "${requiredTargeting}".`, definition.id);
  }
}

export function validateContentPackSemantics(
  source: ContentPackSource,
  locations: ContentSourceLocations = {},
): readonly ContentValidationIssue[] {
  const context: ValidationContext = { source, locations, issues: [] };

  validateUniqueIds(context, "traits", source.traits);
  validateUniqueIds(context, "conditions", source.conditions);
  validateUniqueIds(context, "actions", source.actions);
  validateUniqueIds(context, "cards", source.cards);
  validateUniqueIds(context, "equipment", source.equipment);
  validateUniqueIds(context, "actors", source.actors);
  validateUniqueIds(context, "scenarios", source.scenarios);
  validateUniqueIds(context, "adventures", source.adventures);

  const knownTraits = new Set(source.traits.map((definition) => definition.id));
  const knownConditions = new Set(source.conditions.map((definition) => definition.id));
  const knownActions = new Set(source.actions.map((definition) => definition.id));
  const knownCards = new Set(source.cards.map((definition) => definition.id));
  const knownEquipment = new Set(source.equipment.map((definition) => definition.id));
  const equipmentById = new Map(source.equipment.map((definition) => [definition.id, definition]));
  const knownActors = new Set(source.actors.map((definition) => definition.id));

  source.traits.forEach((definition, definitionIndex) => {
    validateStatModifiers(context, "traits", definition.id, `[${definitionIndex}].statModifiers`, definition.statModifiers);
    const grantKeys = new Set<string>();
    definition.cardGrants.forEach((grant, index) => {
      const key = `card:${grant.cardDefinitionId}`;
      if (!knownCards.has(grant.cardDefinitionId)) {
        addIssue(context, "traits", `[${definitionIndex}].cardGrants[${index}].cardDefinitionId`, "UNKNOWN_CARD", `Card "${grant.cardDefinitionId}" is not defined.`, definition.id);
      }
      if (grantKeys.has(key)) {
        addIssue(context, "traits", `[${definitionIndex}].cardGrants[${index}]`, "DUPLICATE_PROVIDER_GRANT", `Trait "${definition.id}" grants card "${grant.cardDefinitionId}" more than once.`, definition.id);
      }
      grantKeys.add(key);
    });
    definition.actionGrants.forEach((grant, index) => {
      const key = `action:${grant.actionId}:${grant.contextGroup}`;
      if (!knownActions.has(grant.actionId)) {
        addIssue(context, "traits", `[${definitionIndex}].actionGrants[${index}].actionId`, "UNKNOWN_ACTION", `Action "${grant.actionId}" is not defined.`, definition.id);
      }
      if (grantKeys.has(key)) {
        addIssue(context, "traits", `[${definitionIndex}].actionGrants[${index}]`, "DUPLICATE_PROVIDER_GRANT", `Trait "${definition.id}" grants action "${grant.actionId}" more than once.`, definition.id);
      }
      grantKeys.add(key);
    });
  });

  const conditionsById = new Map(source.conditions.map((definition) => [definition.id, definition]));

  source.conditions.forEach((definition, index) => {
    validateTraits(context, knownTraits, "conditions", definition.id, `[${index}].traits`, definition.traits);
    validateStatModifiers(context, "conditions", definition.id, `[${index}].statModifiers`, definition.statModifiers);
    const policy = definition.valuePolicy;
    if (policy && policy.max <= policy.min) {
      addIssue(context, "conditions", `[${index}].valuePolicy`, "INVALID_CONDITION_VALUE_POLICY", `Condition "${definition.id}" needs max greater than min.`, definition.id);
    }
    // Scaling only means something for a Condition that actually contributes a modifier.
    if (policy && (definition.statModifiers ?? []).length === 0) {
      addIssue(context, "conditions", `[${index}].valuePolicy`, "INVALID_CONDITION_VALUE_POLICY", `Condition "${definition.id}" scales modifiers by value but declares none.`, definition.id);
    }
  });

  source.actions.forEach((definition, index) => {
    validateTraits(context, knownTraits, "actions", definition.id, `[${index}].traits`, definition.traits);
    const resolution = definition.resolution;
    const path = `[${index}]`;
    if (!RESOLUTION_TARGETING[resolution.kind].includes(definition.targeting)) {
      addIssue(context, "actions", `${path}.targeting`, "INCOMPATIBLE_TARGETING", `Resolution "${resolution.kind}" cannot use targeting "${definition.targeting}".`, definition.id);
    }
    // Reach is only meaningful where a weapon is actually involved.
    if (definition.range?.kind === "weapon-reach" && resolution.kind !== "strike" && !hasAttackTrait(definition)) {
      addIssue(context, "actions", `${path}.range`, "WEAPON_REACH_NOT_APPLICABLE", `Action "${definition.id}" uses weapon reach without a Strike resolution or the attack trait.`, definition.id);
    }
    if (definition.range?.kind === "feet" && (!Number.isInteger(definition.range.value) || definition.range.value <= 0 || definition.range.value % 5 !== 0)) {
      addIssue(context, "actions", `${path}.range.value`, "INVALID_ACTION_RANGE", "Action range must be a positive multiple of 5 feet.", definition.id);
    }
    // MAP stages are counted from attack usage, so declaring a count without the trait
    // would silently do nothing.
    if (definition.mapAttackCount !== undefined && !hasAttackTrait(definition)) {
      addIssue(context, "actions", `${path}.mapAttackCount`, "MAP_COUNT_NOT_APPLICABLE", `Action "${definition.id}" declares a MAP attack count without the attack trait.`, definition.id);
    }
    // `weapon-mode` reads the resolved Strike, which only an attack-flavoured Action has.
    for (const [requirementIndex, requirement] of (definition.requirements ?? []).entries()) {
      if (requirement.kind === "weapon-mode" && resolution.kind !== "strike" && !hasAttackTrait(definition)) {
        addIssue(context, "actions", `${path}.requirements[${String(requirementIndex)}]`, "REQUIREMENT_NOT_APPLICABLE", `Action "${definition.id}" requires a weapon mode without a Strike resolution or the attack trait.`, definition.id);
      }
    }

    if (resolution.kind === "check") {
      validateActionCheck(context, definition, `${path}.resolution.check`, resolution.check);
    }
    if (resolution.kind === "check" || resolution.kind === "strike") {
      for (const degree of DEGREES) {
        const outcomes = resolution.outcomes[degree];
        if (!outcomes) {
          addIssue(context, "actions", `${path}.resolution.outcomes.${degree}`, "INCOMPLETE_DEGREE_OUTCOMES", `Action "${definition.id}" does not declare outcomes for "${degree}".`, definition.id);
          continue;
        }
        outcomes.forEach((outcome, outcomeIndex) => {
          validateOutcomeEffect(context, knownConditions, conditionsById, knownActions, definition, `${path}.resolution.outcomes.${degree}[${outcomeIndex}]`, outcome);
        });
      }
    }
    if (resolution.kind === "direct") {
      resolution.effects.forEach((outcome, outcomeIndex) => {
        validateOutcomeEffect(context, knownConditions, conditionsById, knownActions, definition, `${path}.resolution.effects[${outcomeIndex}]`, outcome);
      });
    }
  });

  source.cards.forEach((definition, index) => {
    if (!knownActions.has(definition.actionId)) {
      addIssue(context, "cards", `[${index}].actionId`, "UNKNOWN_ACTION", `Action "${definition.actionId}" is not defined.`, definition.id);
    }
    validateTraits(context, knownTraits, "cards", definition.id, `[${index}].traits`, definition.traits);
  });

  source.equipment.forEach((definition, index) => {
    validateTraits(context, knownTraits, "equipment", definition.id, `[${index}].traits`, definition.traits);
    validateStatModifiers(context, "equipment", definition.id, `[${index}].statModifiers`, definition.statModifiers);
    if (definition.slot === "armor" && !definition.armorProfile) {
      addIssue(context, "equipment", `[${index}].armorProfile`, "ARMOR_PROFILE_REQUIRED", `Armor slot equipment "${definition.id}" must declare an armor profile.`, definition.id);
    }
    if (definition.slot !== "armor" && definition.armorProfile) {
      addIssue(context, "equipment", `[${index}].armorProfile`, "ARMOR_PROFILE_SLOT_MISMATCH", `Equipment "${definition.id}" declares an armor profile but occupies the ${definition.slot} slot.`, definition.id);
    }
    if (definition.slot !== "shield" && definition.shieldBonus !== undefined) {
      addIssue(context, "equipment", `[${index}].shieldBonus`, "SHIELD_BONUS_SLOT_MISMATCH", `Equipment "${definition.id}" declares a shield bonus but occupies the ${definition.slot} slot.`, definition.id);
    }
    if (definition.slot === "weapon" && !definition.weaponProfile) {
      addIssue(context, "equipment", `[${index}].weaponProfile`, "WEAPON_PROFILE_REQUIRED", `Weapon slot equipment "${definition.id}" must declare a weapon profile.`, definition.id);
    }
    if (definition.slot !== "weapon" && definition.weaponProfile) {
      addIssue(context, "equipment", `[${index}].weaponProfile`, "WEAPON_PROFILE_SLOT_MISMATCH", `Equipment "${definition.id}" declares a weapon profile but occupies the ${definition.slot} slot.`, definition.id);
    }
    if (definition.weaponProfile) {
      validateStrikeShape(context, "equipment", definition.id, `[${index}].weaponProfile`, definition.weaponProfile, knownTraits);
    }
  });

  source.actors.forEach((actor, index) => {
    validateTraits(context, knownTraits, "actors", actor.id, `[${index}].traits`, actor.traits);
    if (actor.traits.some((trait) => trait.id === "playable") && actor.statProfile.kind !== "character") {
      addIssue(
        context,
        "actors",
        `[${index}].statProfile.kind`,
        "PLAYABLE_REQUIRES_CHARACTER_STATS",
        `Playable actor "${actor.id}" must use a character statistic profile.`,
        actor.id,
      );
    }
    if (actor.statProfile.kind === "character") {
      validateStrikeShape(context, "actors", actor.id, `[${index}].statProfile.stats.offense.unarmedStrike`, actor.statProfile.stats.offense.unarmedStrike, knownTraits);
      if (actor.statProfile.stats.offense.unarmedStrike.category !== "unarmed") {
        addIssue(
          context,
          "actors",
          `[${index}].statProfile.stats.offense.unarmedStrike.category`,
          "UNARMED_STRIKE_CATEGORY_MISMATCH",
          `Actor "${actor.id}" declares an unarmed Strike in the "${actor.statProfile.stats.offense.unarmedStrike.category}" weapon category.`,
          actor.id,
        );
      }
    } else {
      validateStrikeShape(context, "actors", actor.id, `[${index}].statProfile.stats.strike`, actor.statProfile.stats.strike, knownTraits);
    }
    if (actor.statProfile.kind === "character" && deriveMaxHp(actor.statProfile.stats) < 1) {
      addIssue(
        context,
        "actors",
        `[${index}].statProfile.stats.defense`,
        "DERIVED_MAX_HP_NOT_POSITIVE",
        `Actor "${actor.id}" derives ${deriveMaxHp(actor.statProfile.stats)} maximum HP; ancestry, class, and CON must total at least 1.`,
        actor.id,
      );
    }
    Object.entries(actor.starterLoadout.equipment).forEach(([slot, equipmentId]) => {
      if (!equipmentId) return;
      if (!knownEquipment.has(equipmentId)) {
        addIssue(context, "actors", `[${index}].starterLoadout.equipment.${slot}`, "UNKNOWN_EQUIPMENT", `Equipment "${equipmentId}" is not defined.`, actor.id);
      }
      const equipment = equipmentById.get(equipmentId);
      if (equipment && equipment.slot !== slot) {
        addIssue(context, "actors", `[${index}].starterLoadout.equipment.${slot}`, "SLOT_MISMATCH", `Equipment "${equipmentId}" belongs in slot "${equipment.slot}", not "${slot}".`, actor.id);
      }
    });
    if (actor.starterLoadout.preparedCards.length > actor.loadoutProfile.preparedCardCapacity) {
      addIssue(context, "actors", `[${index}].starterLoadout.preparedCards`, "PREPARED_CAPACITY_EXCEEDED", `Actor "${actor.id}" prepares ${actor.starterLoadout.preparedCards.length} cards but capacity is ${actor.loadoutProfile.preparedCardCapacity}.`, actor.id);
    }
    actor.starterLoadout.preparedCards.forEach((cardId, cardIndex) => {
      if (!knownCards.has(cardId)) {
        addIssue(context, "actors", `[${index}].starterLoadout.preparedCards[${cardIndex}]`, "UNKNOWN_CARD", `Card "${cardId}" is not defined.`, actor.id);
      }
    });
    actor.innateActionIds.forEach((actionId, actionIndex) => {
      if (!knownActions.has(actionId)) {
        addIssue(context, "actors", `[${index}].innateActionIds[${actionIndex}]`, "UNKNOWN_ACTION", `Action "${actionId}" is not defined.`, actor.id);
      }
    });
    actor.baseCardGrants.forEach((grant, grantIndex) => {
      if (!knownCards.has(grant.cardDefinitionId)) {
        addIssue(context, "actors", `[${index}].baseCardGrants[${grantIndex}].cardDefinitionId`, "UNKNOWN_CARD", `Card "${grant.cardDefinitionId}" is not defined.`, actor.id);
      }
      if (grant.traitId && !knownTraits.has(grant.traitId)) {
        addIssue(context, "actors", `[${index}].baseCardGrants[${grantIndex}].traitId`, "UNKNOWN_TRAIT", `Trait "${grant.traitId}" is not defined.`, actor.id);
      }
    });
    (actor.initialConditions ?? []).forEach((condition, conditionIndex) => {
      const path = `[${index}].initialConditions[${conditionIndex}]`;
      if (!knownConditions.has(condition.id)) {
        addIssue(context, "actors", `${path}.id`, "UNKNOWN_CONDITION", `Condition "${condition.id}" is not defined.`, actor.id);
        return;
      }
      // An Actor starts combat with these, so an unbounded value here would reach the
      // modifier stack exactly like a bad outcome effect would.
      validateConditionValue(context, "actors", conditionsById, actor.id, `${path}.value`, condition.id, condition.value);
    });
  });

  source.scenarios.forEach((scenario, scenarioIndex) => {
    const prefix = `[${scenarioIndex}]`;
    const map = scenario.map;
    const tileIds = new Set<string>();
    const tilePositions = new Set<string>();
    for (const [index, tile] of map.tiles.entries()) {
      const key = positionKey(tile.position);
      if (tileIds.has(tile.id)) addIssue(context, "scenarios", `${prefix}.map.tiles[${index}].id`, "DUPLICATE_TILE_ID", `Duplicate tile ID "${tile.id}".`, scenario.id);
      if (tilePositions.has(key)) addIssue(context, "scenarios", `${prefix}.map.tiles[${index}].position`, "DUPLICATE_TILE_POSITION", `Multiple tiles occupy ${key}.`, scenario.id);
      if (tile.position.x < 0 || tile.position.y < 0 || tile.position.x >= map.width || tile.position.y >= map.height) {
        addIssue(context, "scenarios", `${prefix}.map.tiles[${index}].position`, "TILE_OUT_OF_BOUNDS", `Tile "${tile.id}" is outside ${map.width}x${map.height} map bounds.`, scenario.id);
      }
      tileIds.add(tile.id);
      tilePositions.add(key);
      validateTraits(context, knownTraits, "scenarios", tile.id, `${prefix}.map.tiles[${index}].traits`, tile.traits);
    }

    const objectIds = new Set<string>();
    for (const [index, object] of map.objects.entries()) {
      if (objectIds.has(object.id)) addIssue(context, "scenarios", `${prefix}.map.objects[${index}].id`, "DUPLICATE_MAP_OBJECT_ID", `Duplicate map object ID "${object.id}".`, object.id);
      if (object.position.x < 0 || object.position.y < 0 || object.position.x >= map.width || object.position.y >= map.height) {
        addIssue(context, "scenarios", `${prefix}.map.objects[${index}].position`, "MAP_OBJECT_OUT_OF_BOUNDS", `Map object "${object.id}" is outside map bounds.`, object.id);
      }
      if (!tileIds.has(object.interaction.targetTileId)) {
        addIssue(context, "scenarios", `${prefix}.map.objects[${index}].interaction.targetTileId`, "UNKNOWN_TARGET_TILE", `Interaction target tile "${object.interaction.targetTileId}" is not defined.`, object.id);
      }
      objectIds.add(object.id);
      validateTraits(context, knownTraits, "scenarios", object.id, `${prefix}.map.objects[${index}].traits`, object.traits);
    }

    const placementIds = new Set<string>();
    const occupied = new Set<string>();
    scenario.placements.forEach((placement, placementIndex) => {
      const path = `${prefix}.placements[${placementIndex}]`;
      if (!knownActors.has(placement.actorDefinitionId)) {
        addIssue(context, "scenarios", `${path}.actorDefinitionId`, "UNKNOWN_ACTOR", `Actor definition "${placement.actorDefinitionId}" is not defined.`, placement.instanceId);
      }
      if (placementIds.has(placement.instanceId)) {
        addIssue(context, "scenarios", `${path}.instanceId`, "DUPLICATE_PLACEMENT_ID", `Placement instance "${placement.instanceId}" is duplicated.`, scenario.id);
      }
      if (placement.team === "heroes") {
        addIssue(context, "scenarios", `${path}.team`, "STATIC_HERO_PLACEMENT", "Party heroes must use partySpawnSlots instead of static placements.", placement.instanceId);
      }
      const key = positionKey(placement.position);
      const tile = map.tiles.find((candidate) => positionKey(candidate.position) === key);
      if (!tile) {
        addIssue(context, "scenarios", `${path}.position`, "ACTOR_TILE_MISSING", `Placement "${placement.instanceId}" starts on undefined tile ${key}.`, placement.instanceId);
      } else if (tile.traits.some((trait) => trait.id === "blocked" || trait.id === "impassable")) {
        addIssue(context, "scenarios", `${path}.position`, "ACTOR_TILE_BLOCKED", `Placement "${placement.instanceId}" starts on blocked tile "${tile.id}".`, placement.instanceId);
      }
      if (occupied.has(key)) addIssue(context, "scenarios", `${path}.position`, "ACTOR_POSITION_CONFLICT", `Multiple actors start at ${key}.`, placement.instanceId);
      placementIds.add(placement.instanceId);
      occupied.add(key);
    });

    const spawnSeats = new Set<number>();
    const spawnPositions = new Set<string>();
    scenario.partySpawnSlots.forEach((spawn, spawnIndex) => {
      const path = `${prefix}.partySpawnSlots[${spawnIndex}]`;
      if (spawnSeats.has(spawn.seat)) {
        addIssue(context, "scenarios", `${path}.seat`, "DUPLICATE_PARTY_SPAWN_SEAT", `Party spawn seat ${spawn.seat} is duplicated.`, scenario.id);
      }
      const key = positionKey(spawn.position);
      const tile = map.tiles.find((candidate) => positionKey(candidate.position) === key);
      if (!tile) {
        addIssue(context, "scenarios", `${path}.position`, "PARTY_SPAWN_TILE_MISSING", `Party spawn seat ${spawn.seat} starts on undefined tile ${key}.`, scenario.id);
      } else if (tile.traits.some((trait) => trait.id === "blocked" || trait.id === "impassable")) {
        addIssue(context, "scenarios", `${path}.position`, "PARTY_SPAWN_TILE_BLOCKED", `Party spawn seat ${spawn.seat} starts on blocked tile "${tile.id}".`, scenario.id);
      }
      if (occupied.has(key)) {
        addIssue(context, "scenarios", `${path}.position`, "PARTY_SPAWN_STATIC_CONFLICT", `Party spawn seat ${spawn.seat} conflicts with a static actor at ${key}.`, scenario.id);
      }
      if (spawnPositions.has(key)) {
        addIssue(context, "scenarios", `${path}.position`, "DUPLICATE_PARTY_SPAWN_POSITION", `Multiple party spawn slots occupy ${key}.`, scenario.id);
      }
      spawnSeats.add(spawn.seat);
      spawnPositions.add(key);
    });
  });

  const knownScenarios = new Set(source.scenarios.map((scenario) => scenario.id));
  const scenariosById = new Map(source.scenarios.map((scenario) => [scenario.id, scenario]));
  source.adventures.forEach((adventure, adventureIndex) => {
    if (adventure.partySize.min > adventure.partySize.max) {
      addIssue(context, "adventures", `[${adventureIndex}].partySize`, "INVALID_PARTY_SIZE", `Adventure party minimum ${adventure.partySize.min} exceeds maximum ${adventure.partySize.max}.`, adventure.id);
    }
    const encounterSeen = new Set<string>();
    adventure.encounterIds.forEach((scenarioId, encounterIndex) => {
      const path = `[${adventureIndex}].encounterIds[${encounterIndex}]`;
      if (!knownScenarios.has(scenarioId)) addIssue(context, "adventures", path, "UNKNOWN_SCENARIO", `Scenario "${scenarioId}" is not defined.`, adventure.id);
      const scenario = scenariosById.get(scenarioId);
      if (scenario && scenario.partySpawnSlots.length < adventure.partySize.max) {
        addIssue(context, "adventures", path, "INSUFFICIENT_PARTY_SPAWNS", `Scenario "${scenarioId}" provides ${scenario.partySpawnSlots.length} party spawn slots but adventure maximum is ${adventure.partySize.max}.`, adventure.id);
      }
      if (scenario) {
        const availableSeats = new Set(scenario.partySpawnSlots.map((spawn) => spawn.seat));
        for (const seat of [1, 2, 3] as const) {
          if (seat > adventure.partySize.max) break;
          if (!availableSeats.has(seat)) {
            addIssue(context, "adventures", path, "MISSING_PARTY_SPAWN_SEAT", `Scenario "${scenarioId}" is missing required party spawn seat ${seat}.`, adventure.id);
          }
        }
      }
      if (encounterSeen.has(scenarioId)) addIssue(context, "adventures", path, "DUPLICATE_ADVENTURE_ENCOUNTER", `Adventure repeats scenario "${scenarioId}".`, adventure.id);
      encounterSeen.add(scenarioId);
    });
    const rewardIds = new Set<string>();
    const rewardedEncounters = new Set<string>();
    adventure.rewards.forEach((reward, rewardIndex) => {
      const path = `[${adventureIndex}].rewards[${rewardIndex}]`;
      if (rewardIds.has(reward.id)) addIssue(context, "adventures", `${path}.id`, "DUPLICATE_REWARD_ID", `Reward "${reward.id}" is duplicated.`, adventure.id);
      if (!adventure.encounterIds.includes(reward.afterEncounterId)) addIssue(context, "adventures", `${path}.afterEncounterId`, "REWARD_OUTSIDE_ADVENTURE", `Reward references encounter "${reward.afterEncounterId}" outside its adventure.`, reward.id);
      if (rewardedEncounters.has(reward.afterEncounterId)) addIssue(context, "adventures", `${path}.afterEncounterId`, "DUPLICATE_ENCOUNTER_REWARD", `Encounter "${reward.afterEncounterId}" has more than one reward offer.`, reward.id);
      reward.choices.forEach((choice, choiceIndex) => {
        const known = choice.kind === "equipment" ? knownEquipment : knownCards;
        if (!known.has(choice.definitionId)) addIssue(context, "adventures", `${path}.choices[${choiceIndex}].definitionId`, choice.kind === "equipment" ? "UNKNOWN_EQUIPMENT" : "UNKNOWN_CARD", `${choice.kind} "${choice.definitionId}" is not defined.`, reward.id);
      });
      rewardIds.add(reward.id);
      rewardedEncounters.add(reward.afterEncounterId);
    });
  });

  return context.issues.sort(
    (left, right) =>
      left.source.localeCompare(right.source) ||
      left.path.localeCompare(right.path) ||
      left.code.localeCompare(right.code),
  );
}

export function formatContentValidationIssue(issue: ContentValidationIssue): string {
  const pack = issue.packId ?? "unknown";
  const definition = issue.definitionId ? `\nDefinition: ${issue.definitionId}` : "";
  return `Pack: ${pack}\nSource: ${issue.source}${definition}\nPath: ${issue.path}\n${issue.code}: ${issue.message}`;
}
