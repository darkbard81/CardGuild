import { positionKey } from "../game/grid";
import type {
  ActionDefinition,
  ActionTargeting,
  ConditionId,
  TraitInstance,
  WeaponProfile,
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

const EXPECTED_TARGETING: Readonly<Record<ActionDefinition["effect"]["kind"], ActionTargeting>> = {
  move: "tile",
  "weapon-attack": "enemy",
  trip: "enemy",
  "remove-condition": "self",
  "recovery-check": "self",
  "raise-shield": "self",
  interact: "object",
  "create-sustained-effect": "self",
  "sustain-effect": "effect",
};

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

function validateWeaponProfile(
  context: ValidationContext,
  category: "equipment" | "actors",
  definitionId: string,
  path: string,
  weapon: WeaponProfile,
): void {
  if (!Number.isInteger(weapon.rangeFeet) || weapon.rangeFeet <= 0 || weapon.rangeFeet % 5 !== 0) {
    addIssue(context, category, `${path}.rangeFeet`, "INVALID_WEAPON_RANGE", "Weapon range must be a positive multiple of 5 feet.", definitionId);
  }
  if (!Number.isInteger(weapon.damage.count) || weapon.damage.count < 1 || !Number.isInteger(weapon.damage.sides) || weapon.damage.sides < 2) {
    addIssue(context, category, `${path}.damage`, "INVALID_DAMAGE_DICE", "Weapon damage dice must have a positive count and at least 2 sides.", definitionId);
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

  source.conditions.forEach((definition, index) => {
    validateTraits(context, knownTraits, "conditions", definition.id, `[${index}].traits`, definition.traits);
  });

  source.actions.forEach((definition, index) => {
    validateTraits(context, knownTraits, "actions", definition.id, `[${index}].traits`, definition.traits);
    const expectedTargeting = EXPECTED_TARGETING[definition.effect.kind];
    if (definition.targeting !== expectedTargeting) {
      addIssue(context, "actions", `[${index}].targeting`, "INCOMPATIBLE_TARGETING", `Effect "${definition.effect.kind}" requires targeting "${expectedTargeting}".`, definition.id);
    }
    const effect = definition.effect;
    if (effect.kind === "weapon-attack" && effect.applyCondition) {
      validateConditionReference(context, knownConditions, definition, effect.applyCondition, `[${index}].effect.applyCondition`);
    } else if (effect.kind === "remove-condition" || effect.kind === "recovery-check") {
      validateConditionReference(context, knownConditions, definition, effect.condition, `[${index}].effect.condition`);
    }
    if (effect.kind === "recovery-check") {
      for (const [degree, outcomes] of Object.entries(effect.outcomes)) {
        outcomes.forEach((outcome, outcomeIndex) => {
          if (outcome.kind === "remove-condition") {
            validateConditionReference(context, knownConditions, definition, outcome.condition, `[${index}].effect.outcomes.${degree}[${outcomeIndex}].condition`);
          } else if (!knownActions.has(outcome.actionId)) {
            addIssue(context, "actions", `[${index}].effect.outcomes.${degree}[${outcomeIndex}].actionId`, "UNKNOWN_ACTION", `Action "${outcome.actionId}" is not defined.`, definition.id);
          }
        });
      }
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
    if (definition.weaponProfile) validateWeaponProfile(context, "equipment", definition.id, `[${index}].weaponProfile`, definition.weaponProfile);
  });

  source.actors.forEach((actor, index) => {
    validateTraits(context, knownTraits, "actors", actor.id, `[${index}].traits`, actor.traits);
    validateWeaponProfile(context, "actors", actor.id, `[${index}].fallbackWeapon`, actor.fallbackWeapon);
    if (actor.hp > actor.maxHp) {
      addIssue(context, "actors", `[${index}].hp`, "HP_EXCEEDS_MAXIMUM", `Actor "${actor.id}" has ${actor.hp} HP but maximum HP is ${actor.maxHp}.`, actor.id);
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
      if (!knownConditions.has(condition.id)) {
        addIssue(context, "actors", `[${index}].initialConditions[${conditionIndex}].id`, "UNKNOWN_CONDITION", `Condition "${condition.id}" is not defined.`, actor.id);
      }
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
