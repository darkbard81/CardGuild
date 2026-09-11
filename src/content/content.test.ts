import { describe, expect, it } from "vitest";

import contentPackSchema from "../../content/schema/content-pack.schema.json";
import type { PartySetup } from "../adventure";
import { createCombat, dispatchCombatCommand } from "../game/engine";
import { listLegalActions } from "../game/queries";
import { findReachableTiles } from "../game/grid";
import { resolveMapPenalty, resolveStrike } from "../game/offense";
import type { CombatCommand, TraitDefinition } from "../game/types";
import {
  clonePartyLoadout,
  createStartingCollection,
  deriveLoadoutSnapshot,
  validatePartyLoadout,
} from "../loadout";
import { ContentCompilationError, compileContentPack, getCombatDefinition } from "./compile-content";
import type { ActorDefinition, ContentPackSource } from "./content-types";
import { fingerprintContentPack } from "./fingerprint";
import {
  RUINED_GATE_ID,
  createCharacterRulesContentSource,
  createCharacterRulesFixture,
  createCoreContentSource,
} from "../../tests/fixtures/content";
import { validateContentPackStructure } from "./validate-content";
import { formatContentValidationIssue, validateContentPackSemantics } from "./validate-semantics";

function sourceCopy(): ContentPackSource {
  return createCoreContentSource();
}

/** The character rules, which is where the weapon, armor and spell authoring lives. */
function characterRulesCopy(): ContentPackSource {
  return createCharacterRulesContentSource();
}

function withPerception(actor: ActorDefinition, value: number): ActorDefinition {
  return actor.statProfile.kind === "character"
    ? {
        ...actor,
        statProfile: {
          kind: "character",
          stats: {
            ...actor.statProfile.stats,
            attributes: { ...actor.statProfile.stats.attributes, wis: value },
            perception: "untrained",
          },
        },
      }
    : {
        ...actor,
        statProfile: {
          kind: "creature",
          stats: { ...actor.statProfile.stats, perception: value },
        },
      };
}

describe("content structural validation", () => {
  it("accepts the core pack and rejects missing fields, invalid unions, and numeric ranges", () => {
    expect(validateContentPackStructure(createCoreContentSource(), contentPackSchema)).toEqual([]);

    const source = sourceCopy();
    const missingVersion = {
      ...source,
      manifest: {
        schemaVersion: source.manifest.schemaVersion,
        id: source.manifest.id,
        rulesetId: source.manifest.rulesetId,
      },
    };
    expect(validateContentPackStructure(missingVersion, contentPackSchema).some((issue) => issue.path.endsWith("/version"))).toBe(true);

    const invalidUnion = {
      ...source,
      actions: [
        { ...source.actions[0], effect: { kind: "move", movementMode: "land" } },
        ...source.actions.slice(1),
      ],
    };
    expect(validateContentPackStructure(invalidUnion, contentPackSchema).some((issue) => issue.source === "actions")).toBe(true);

    const invalidRange = {
      ...source,
      actors: [{ ...source.actors[0], maxHp: 0 }, ...source.actors.slice(1)],
    };
    expect(validateContentPackStructure(invalidRange, contentPackSchema).some((issue) => issue.path.includes("maxHp"))).toBe(true);

    const legacyV4 = {
      ...source,
      manifest: { ...source.manifest, schemaVersion: 4 },
    };
    expect(validateContentPackStructure(legacyV4, contentPackSchema).some((issue) => issue.path.endsWith("/schemaVersion"))).toBe(true);

    const actor = source.actors[0] as NonNullable<typeof source.actors[0]>;
    if (actor.statProfile.kind !== "character") throw new Error("The character fixture is missing.");
    const missingSkill = structuredClone(source) as unknown as {
      actors: Array<{ statProfile: { stats: { skills: Record<string, unknown> } } }>;
    };
    delete missingSkill.actors[0]?.statProfile.stats.skills.athletics;
    expect(validateContentPackStructure(missingSkill, contentPackSchema).some((issue) =>
      issue.path.includes("/statProfile/stats/skills"))).toBe(true);
  });

  it("formats structural issues with pack identity and source context", () => {
    const source = sourceCopy();
    const missingVersion = {
      ...source,
      manifest: {
        schemaVersion: source.manifest.schemaVersion,
        id: source.manifest.id,
        rulesetId: source.manifest.rulesetId,
      },
    };
    const issue = validateContentPackStructure(missingVersion, contentPackSchema, {
      manifest: "content/test/manifest.json",
    })[0];
    expect(issue).toBeDefined();
    expect(formatContentValidationIssue(issue as NonNullable<typeof issue>)).toContain(
      "Pack: cardguild.test.core\nSource: content/test/manifest.json",
    );
    expect(formatContentValidationIssue(issue as NonNullable<typeof issue>)).toContain("Path: /manifest/version");
  });
});

describe("content semantic validation and compilation", () => {
  it("reports precise source, definition, and code for invalid references and duplicates", () => {
    const source = sourceCopy();
    const firstTrait = source.traits[0] as NonNullable<typeof source.traits[0]>;
    const invalid: ContentPackSource = {
      ...source,
      traits: [...source.traits, { ...firstTrait }],
      equipment: [
        {
          ...(source.equipment[0] as NonNullable<typeof source.equipment[0]>),
          traits: [{ id: "tirp" }],
        },
        ...source.equipment.slice(1),
      ],
      cards: [
        {
          ...(source.cards[0] as NonNullable<typeof source.cards[0]>),
          actionId: "missing-action",
        },
        ...source.cards.slice(1),
      ],
    };
    const issues = validateContentPackSemantics(invalid, {
      equipment: "content/test/equipment.json",
    });

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "DUPLICATE_ID" }),
        expect.objectContaining({ code: "UNKNOWN_ACTION", definitionId: "card.trip" }),
        expect.objectContaining({
          source: "content/test/equipment.json",
          code: "UNKNOWN_TRAIT",
          definitionId: "halberd",
        }),
      ]),
    );
  });

  it("formats semantic issues with pack, source, definition, path, code, and reason", () => {
    const source = sourceCopy();
    const halberd = source.equipment.find((item) => item.id === "halberd") as NonNullable<typeof source.equipment[0]>;
    const invalid: ContentPackSource = {
      ...source,
      equipment: source.equipment.map((item) =>
        item.id === halberd.id ? { ...item, traits: [{ id: "tirp" }] } : item,
      ),
    };
    const issue = validateContentPackSemantics(invalid, {
      equipment: "content/test/equipment.json",
    }).find((candidate) => candidate.code === "UNKNOWN_TRAIT");
    expect(issue).toBeDefined();
    expect(formatContentValidationIssue(issue as NonNullable<typeof issue>)).toBe(
      [
        "Pack: cardguild.test.core",
        "Source: content/test/equipment.json",
        "Definition: halberd",
        "Path: [0].traits[0].id",
        'UNKNOWN_TRAIT: Trait "tirp" is not defined.',
      ].join("\n"),
    );
  });

  it("validates deterministic v5 party spawn seats, positions, and adventure capacity", () => {
    const source = sourceCopy();
    const firstScenario = source.scenarios[0] as NonNullable<typeof source.scenarios[0]>;
    const firstSpawn = firstScenario.partySpawnSlots[0] as NonNullable<typeof firstScenario.partySpawnSlots[0]>;
    const staticPosition = firstScenario.placements[0]?.position as NonNullable<typeof firstScenario.placements[0]>["position"];
    const invalid: ContentPackSource = {
      ...source,
      scenarios: source.scenarios.map((scenario, index) => index === 0
        ? {
            ...scenario,
            partySpawnSlots: [
              firstSpawn,
              { ...firstSpawn, position: staticPosition },
            ],
          }
        : scenario),
    };

    const codes = validateContentPackSemantics(invalid).map((issue) => issue.code);
    expect(codes).toEqual(expect.arrayContaining([
      "DUPLICATE_PARTY_SPAWN_SEAT",
      "PARTY_SPAWN_STATIC_CONFLICT",
      "INSUFFICIENT_PARTY_SPAWNS",
    ]));
  });

  it("requires every party seat through the Adventure maximum instead of accepting a slot count", () => {
    const source = sourceCopy();
    const adventure = source.adventures[0] as NonNullable<typeof source.adventures[0]>;
    const invalid: ContentPackSource = {
      ...source,
      adventures: source.adventures.map((candidate) => candidate.id === adventure.id
        ? { ...candidate, partySize: { min: 1, max: 2 } }
        : candidate),
      scenarios: source.scenarios.map((scenario) => adventure.encounterIds.includes(scenario.id)
        ? { ...scenario, partySpawnSlots: scenario.partySpawnSlots.filter((spawn) => spawn.seat !== 2) }
        : scenario),
    };

    const issues = validateContentPackSemantics(invalid);
    const missingSeatIssues = issues.filter((issue) => issue.code === "MISSING_PARTY_SPAWN_SEAT");
    expect(missingSeatIssues).toHaveLength(adventure.encounterIds.length);
    expect(missingSeatIssues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        definitionId: adventure.id,
        message: expect.stringContaining("missing required party spawn seat 2"),
      }),
    ]));
    expect(issues.some((issue) => issue.code === "INSUFFICIENT_PARTY_SPAWNS")).toBe(false);
  });

  it("requires exactly one well-formed experience award per encounter", () => {
    const source = sourceCopy();
    const adventure = source.adventures[0] as NonNullable<typeof source.adventures[0]>;
    const awards = adventure.experienceAwards;
    const first = awards[0] as NonNullable<typeof awards[0]>;
    const withAwards = (experienceAwards: typeof awards): ContentPackSource => ({
      ...source,
      adventures: source.adventures.map((candidate) =>
        candidate.id === adventure.id ? { ...candidate, experienceAwards } : candidate),
    });

    // The shipped pack is complete, so any issue below is one this edit introduced.
    expect(validateContentPackSemantics(source).some((issue) => issue.code.includes("EXPERIENCE"))).toBe(false);

    const codesFor = (experienceAwards: typeof awards): readonly string[] =>
      validateContentPackSemantics(withAwards(experienceAwards)).map((issue) => issue.code);

    // A missing entry is an authoring error, never an implied zero.
    expect(codesFor(awards.slice(1))).toContain("MISSING_ENCOUNTER_EXPERIENCE");
    expect(codesFor([...awards, { ...first }])).toContain("DUPLICATE_ENCOUNTER_EXPERIENCE");
    expect(codesFor([...awards, { afterEncounterId: "encounter.not-in-this-adventure", amount: 10 }]))
      .toContain("EXPERIENCE_OUTSIDE_ADVENTURE");
    for (const amount of [-1, 12.5, Number.NaN, Number.MAX_VALUE]) {
      expect(codesFor(awards.map((award) => award.afterEncounterId === first.afterEncounterId ? { ...award, amount } : award)))
        .toContain("INVALID_EXPERIENCE_AMOUNT");
    }

    // An explicit zero is legal: the regression fixtures rely on it to stay growth-free.
    expect(codesFor(awards.map((award) => ({ ...award, amount: 0 }))).some((code) => code.includes("EXPERIENCE"))).toBe(false);

    // The structural schema refuses the field's absence before semantics ever runs.
    const withoutField = {
      ...source,
      adventures: source.adventures.map((candidate) =>
        Object.fromEntries(Object.entries(candidate).filter(([key]) => key !== "experienceAwards"))),
    };
    expect(validateContentPackStructure(withoutField, contentPackSchema)
      .some((issue) => issue.path.endsWith("/experienceAwards"))).toBe(true);
  });

  it("keeps the fingerprint blind to award ordering and sensitive to award amounts", () => {
    const source = sourceCopy();
    const adventure = source.adventures[0] as NonNullable<typeof source.adventures[0]>;
    const first = adventure.experienceAwards[0] as NonNullable<typeof adventure.experienceAwards[0]>;
    const rewrite = (experienceAwards: typeof adventure.experienceAwards): ContentPackSource => ({
      ...source,
      adventures: source.adventures.map((candidate) =>
        candidate.id === adventure.id ? { ...candidate, experienceAwards } : candidate),
    });

    expect(fingerprintContentPack(rewrite([...adventure.experienceAwards].reverse())))
      .toBe(fingerprintContentPack(source));
    expect(fingerprintContentPack(rewrite(adventure.experienceAwards.map((award) =>
      award.afterEncounterId === first.afterEncounterId ? { ...award, amount: award.amount + 1 } : award))))
      .not.toBe(fingerprintContentPack(source));
  });

  it("adds equipment and condition providers using JSON-shaped data without engine changes", () => {
    const source = sourceCopy();
    const custom: ContentPackSource = {
      ...source,
      actions: [
        ...source.actions,
        {
          id: "recover-custom",
          name: "Recover Custom",
          description: "Remove a custom authored condition.",
          timing: { kind: "turn", actions: 1 },
          traits: [{ id: "move" }],
          targeting: "self",
          resolution: { kind: "direct", effects: [{ kind: "remove-condition", owner: "actor", condition: "custom-condition" }] },
        },
      ],
      traits: [
        ...source.traits,
        {
          id: "custom-recovery",
          name: "Custom Recovery",
          source: "cardguild",
          category: "condition",
          description: "테스트용 회복 Trait입니다.",
          cardGrants: [],
          actionGrants: [{ actionId: "recover-custom", contextGroup: "escape" }],
        },
      ],
      conditions: [
        ...source.conditions,
        {
          id: "custom-condition",
          name: "Custom Condition",
          traits: [{ id: "condition" }, { id: "custom-recovery" }],
        },
      ],
      equipment: [
        ...source.equipment,
        {
          id: "trait-only-kit",
          name: "Trait-only Kit",
          slot: "shield",
          traits: [{ id: "trip" }, { id: "fly" }, { id: "shield" }],
          statModifiers: [],
          shieldBonus: 2,
        },
      ],
      actors: source.actors.map((actor) =>
        actor.id === "hero.aerin"
          ? {
              ...withPerception(actor, 100),
              starterLoadout: {
                ...actor.starterLoadout,
                equipment: { shield: "trait-only-kit" },
              },
              initialConditions: [{ id: "custom-condition", sourceId: "test" }],
            }
          : withPerception(actor, -100),
      ),
    };
    const authoredJson = JSON.parse(JSON.stringify(custom)) as unknown;
    expect(validateContentPackStructure(authoredJson, contentPackSchema)).toEqual([]);
    const pack = compileContentPack(authoredJson as ContentPackSource);
    const definition = getCombatDefinition(pack, RUINED_GATE_ID);
    const setup = createCombat(definition, 72);
    const allCards = Object.values(setup.state.cardZones.hero ?? {}).flat() as readonly {
      readonly definitionId: string;
      readonly source: {
        readonly kind: "base" | "prepared" | "equipment-trait";
        readonly equipmentId?: string;
        readonly traitId?: string;
      };
    }[];

    expect(allCards.filter((card) => card.definitionId === "card.trip")).toHaveLength(3);
    expect(allCards.filter((card) => card.definitionId === "card.fly")).toHaveLength(2);
    expect(
      allCards
        .filter((card) => card.definitionId === "card.trip" || card.definitionId === "card.fly")
        .every((card) => card.source.kind === "equipment-trait" && card.source.equipmentId === "trait-only-kit" && card.source.traitId !== undefined),
    ).toBe(true);

    const actions = listLegalActions(setup.state, "hero", pack.combatContent);
    expect(actions.find((action) => action.actionId === "raise-shield")?.enabled).toBe(true);
    const recovery = actions.find((action) => action.actionId === "recover-custom");
    expect(recovery?.contextGroup).toBe("escape");

    const command: CombatCommand = {
      type: "use-action",
      id: "custom-recovery",
      sequence: 1,
      actorId: "hero",
      action: recovery?.source as NonNullable<typeof recovery>["source"],
      target: { kind: "none" },
    };
    const result = dispatchCombatCommand(setup.state, command, pack.combatContent);
    expect(result.accepted).toBe(true);
    expect(result.state.actors.hero?.conditions).toEqual([]);
    expect(result.events).toContainEqual({
      type: "CONDITION_REMOVED",
      actorId: "hero",
      condition: "custom-condition",
    });
  });

  it("requires playable actors to use bottom-up character statistics", () => {
    const source = characterRulesCopy();
    const creature = source.actors.find((actor) => actor.statProfile.kind === "creature");
    const playable = source.actors.find((actor) => actor.traits.some((trait) => trait.id === "playable"));
    if (!creature || !playable) throw new Error("M5 actor fixtures are missing.");
    const invalid: ContentPackSource = {
      ...source,
      actors: source.actors.map((actor) => actor.id === playable.id
        ? { ...actor, statProfile: structuredClone(creature.statProfile) }
        : actor),
    };

    expect(validateContentPackSemantics(invalid)).toContainEqual(expect.objectContaining({
      code: "PLAYABLE_REQUIRES_CHARACTER_STATS",
      definitionId: playable.id,
    }));
  });

  it("keeps final AC and HP out of character authoring while creatures keep fixed stats", () => {
    const source = characterRulesCopy();
    const playable = source.actors.find((actor) => actor.traits.some((trait) => trait.id === "playable"));
    const creature = source.actors.find((actor) => actor.statProfile.kind === "creature");
    if (!playable || !creature || creature.statProfile.kind !== "creature") {
      throw new Error("The character rules fixture is missing actor.");
    }

    expect(creature.statProfile.stats.ac).toBeGreaterThan(0);
    expect(creature.statProfile.stats.maxHp).toBeGreaterThan(0);
    for (const field of ["baseAc", "maxHp", "hp"] as const) {
      const authored: ContentPackSource = {
        ...source,
        actors: source.actors.map((actor) => actor.id === playable.id
          ? { ...actor, [field]: 20 } as typeof actor
          : actor),
      };
      expect(validateContentPackStructure(authored, contentPackSchema)).toContainEqual(expect.objectContaining({
        source: "actors",
        code: "SCHEMA_ADDITIONAL_PROPERTIES",
        path: `/actors/0/${field}`,
        definitionId: playable.id,
      }));
    }
  });

  it("requires an armor profile exactly on armor slot equipment", () => {
    const source = characterRulesCopy();
    const armor = source.equipment.find((definition) => definition.slot === "armor");
    const boots = source.equipment.find((definition) => definition.slot === "feet");
    if (!armor || !boots) throw new Error("The character rules fixture is missing equipment.");

    const withoutProfile: ContentPackSource = {
      ...source,
      equipment: source.equipment.map((definition) => definition.id === armor.id
        ? { ...definition, armorProfile: undefined }
        : definition),
    };
    expect(validateContentPackStructure(withoutProfile, contentPackSchema)).toContainEqual(expect.objectContaining({
      source: "equipment",
      definitionId: armor.id,
    }));
    expect(validateContentPackSemantics(withoutProfile)).toContainEqual(expect.objectContaining({
      code: "ARMOR_PROFILE_REQUIRED",
      definitionId: armor.id,
    }));

    const misplaced: ContentPackSource = {
      ...source,
      equipment: source.equipment.map((definition) => definition.id === boots.id
        ? { ...definition, armorProfile: { category: "light" as const, acItemBonus: 1, dexCap: 4 } }
        : definition),
    };
    expect(validateContentPackStructure(misplaced, contentPackSchema)).toContainEqual(expect.objectContaining({
      source: "equipment",
      definitionId: boots.id,
    }));
    expect(validateContentPackSemantics(misplaced)).toContainEqual(expect.objectContaining({
      code: "ARMOR_PROFILE_SLOT_MISMATCH",
      definitionId: boots.id,
    }));
  });

  it("keeps a shield bonus on the shield slot it belongs to", () => {
    const source = characterRulesCopy();
    const boots = source.equipment.find((definition) => definition.slot === "feet");
    const shield = source.equipment.find((definition) => definition.shieldBonus !== undefined);
    if (!boots || !shield) throw new Error("The character rules fixture is missing equipment.");
    expect(shield.slot).toBe("shield");

    const misplaced: ContentPackSource = {
      ...source,
      equipment: source.equipment.map((definition) => definition.id === boots.id
        ? { ...definition, shieldBonus: 3 }
        : definition),
    };
    expect(validateContentPackStructure(misplaced, contentPackSchema)).toContainEqual(expect.objectContaining({
      source: "equipment",
      definitionId: boots.id,
    }));
    expect(validateContentPackSemantics(misplaced)).toContainEqual(expect.objectContaining({
      code: "SHIELD_BONUS_SLOT_MISMATCH",
      definitionId: boots.id,
    }));
  });

  it("keeps final attack and Attribute-duplicating damage out of player weapon authoring", () => {
    const source = characterRulesCopy();
    const weapon = source.equipment.find((definition) => definition.slot === "weapon");
    if (!weapon?.weaponProfile) throw new Error("The character rules fixture is missing weapon.");
    const profile = weapon.weaponProfile;
    expect(profile).not.toHaveProperty("attackModifier");
    expect(profile.damage).not.toHaveProperty("modifier");

    const authoredAttack: ContentPackSource = {
      ...source,
      equipment: source.equipment.map((definition) => definition.id === weapon.id
        ? { ...definition, weaponProfile: { ...profile, attackModifier: 8 } }
        : definition),
    } as ContentPackSource;
    expect(validateContentPackStructure(authoredAttack, contentPackSchema)).toContainEqual(expect.objectContaining({
      source: "equipment",
      definitionId: weapon.id,
    }));

    const duplicatedStrength: ContentPackSource = {
      ...source,
      equipment: source.equipment.map((definition) => definition.id === weapon.id
        ? { ...definition, weaponProfile: { ...profile, damage: { ...profile.damage, modifier: 3 } } }
        : definition),
    } as ContentPackSource;
    expect(validateContentPackStructure(duplicatedStrength, contentPackSchema)).toContainEqual(expect.objectContaining({
      source: "equipment",
      definitionId: weapon.id,
    }));
  });

  it("requires a weapon profile exactly on weapon slot equipment", () => {
    const source = characterRulesCopy();
    const weapon = source.equipment.find((definition) => definition.slot === "weapon");
    const boots = source.equipment.find((definition) => definition.slot === "feet");
    if (!weapon?.weaponProfile || !boots) throw new Error("The character rules fixture is missing equipment.");
    const weaponProfile = weapon.weaponProfile;

    const withoutProfile: ContentPackSource = {
      ...source,
      equipment: source.equipment.map((definition) => definition.id === weapon.id
        ? { ...definition, weaponProfile: undefined }
        : definition),
    };
    expect(validateContentPackStructure(withoutProfile, contentPackSchema)).toContainEqual(expect.objectContaining({
      source: "equipment",
      definitionId: weapon.id,
    }));
    expect(validateContentPackSemantics(withoutProfile)).toContainEqual(expect.objectContaining({
      code: "WEAPON_PROFILE_REQUIRED",
      definitionId: weapon.id,
    }));

    const misplaced: ContentPackSource = {
      ...source,
      equipment: source.equipment.map((definition) => definition.id === boots.id
        ? { ...definition, weaponProfile }
        : definition),
    };
    expect(validateContentPackStructure(misplaced, contentPackSchema)).toContainEqual(expect.objectContaining({
      source: "equipment",
      definitionId: boots.id,
    }));
    expect(validateContentPackSemantics(misplaced)).toContainEqual(expect.objectContaining({
      code: "WEAPON_PROFILE_SLOT_MISMATCH",
      definitionId: boots.id,
    }));
  });

  it("requires complete offense authoring on characters and a fixed Strike on creatures", () => {
    const source = characterRulesCopy();
    const character = source.actors.find((actor) => actor.statProfile.kind === "character");
    const creature = source.actors.find((actor) => actor.statProfile.kind === "creature");
    if (character?.statProfile.kind !== "character" || creature?.statProfile.kind !== "creature") {
      throw new Error("The character rules fixture is missing actor.");
    }
    const characterStats = character.statProfile.stats;
    const creatureStats = creature.statProfile.stats;
    expect(Object.keys(characterStats.offense.weaponProficiencies).sort())
      .toEqual(["advanced", "martial", "simple", "unarmed"]);

    const partialProficiencies: ContentPackSource = {
      ...source,
      actors: source.actors.map((actor) => actor.id === character.id
        ? {
            ...actor,
            statProfile: {
              kind: "character" as const,
              stats: {
                ...characterStats,
                offense: {
                  ...characterStats.offense,
                  weaponProficiencies: { unarmed: "trained" as const, simple: "trained" as const, martial: "trained" as const },
                },
              },
            },
          }
        : actor),
    } as ContentPackSource;
    expect(validateContentPackStructure(partialProficiencies, contentPackSchema)).toContainEqual(expect.objectContaining({
      source: "actors",
      definitionId: character.id,
    }));

    const armedUnarmedStrike: ContentPackSource = {
      ...source,
      actors: source.actors.map((actor) => actor.id === character.id
        ? {
            ...actor,
            statProfile: {
              kind: "character" as const,
              stats: {
                ...characterStats,
                offense: {
                  ...characterStats.offense,
                  unarmedStrike: { ...characterStats.offense.unarmedStrike, category: "martial" as const },
                },
              },
            },
          }
        : actor),
    };
    expect(validateContentPackSemantics(armedUnarmedStrike)).toContainEqual(expect.objectContaining({
      code: "UNARMED_STRIKE_CATEGORY_MISMATCH",
      definitionId: character.id,
    }));

    // Creatures keep their authored final numbers.
    expect(creatureStats.strike.attackModifier).toBeGreaterThan(0);
    const withoutStrike: ContentPackSource = {
      ...source,
      actors: source.actors.map((actor) => actor.id === creature.id
        ? { ...actor, statProfile: { kind: "creature" as const, stats: { ...creatureStats, strike: undefined } } }
        : actor),
    } as ContentPackSource;
    expect(validateContentPackStructure(withoutStrike, contentPackSchema)).toContainEqual(expect.objectContaining({
      source: "actors",
      definitionId: creature.id,
    }));
  });

  it("keeps Cards a reference to an Action instead of an authored modifier or DC", () => {
    const source = characterRulesCopy();
    const card = source.cards[0];
    if (!card) throw new Error("The character rules fixture is missing card.");
    expect(Object.keys(card).sort()).toEqual(["actionId", "id", "name", "traits"]);

    const authored = { ...source, cards: source.cards.map((entry, index) => index === 0 ? { ...entry, modifier: 7, dc: 18 } : entry) };
    expect(validateContentPackStructure(authored as ContentPackSource, contentPackSchema)).toContainEqual(expect.objectContaining({
      source: "cards",
      definitionId: card.id,
    }));
  });

  it("rejects unknown statistic, attribute, and DC references in a check resolution", () => {
    const source = characterRulesCopy();
    const trip = source.actions.find((action) => action.id === "trip");
    if (trip?.resolution.kind !== "check") throw new Error("The character rules fixture is missing Trip.");
    const tripResolution = trip.resolution;
    const tripCheck = tripResolution.check;

    const withCheck = (check: unknown): ContentPackSource => ({
      ...source,
      actions: source.actions.map((action) => action.id === trip.id
        ? { ...action, resolution: { kind: "check" as const, check, outcomes: tripResolution.outcomes } }
        : action),
    } as ContentPackSource);

    for (const broken of [
      { ...tripCheck, statistic: { kind: "skill" as const, skill: "juggling" } },
      { ...tripCheck, statistic: { kind: "skill" as const, skill: "athletics", attributeOverride: "luck" } },
      { ...tripCheck, dc: { kind: "statistic-dc" as const, owner: "target" as const, statistic: { kind: "save" as const, save: "sanity" } } },
      { ...tripCheck, dc: { kind: "fixed" as const, value: 0 } },
    ]) {
      expect(validateContentPackStructure(withCheck(broken), contentPackSchema)).toContainEqual(expect.objectContaining({
        source: "actions",
        definitionId: trip.id,
      }));
    }

    // A JSON expression is not a statistic reference; the closed union rejects it outright.
    expect(validateContentPackStructure(withCheck({ ...tripCheck, statistic: "athletics + 2" }), contentPackSchema))
      .toContainEqual(expect.objectContaining({ source: "actions", definitionId: trip.id }));
  });

  it("requires all four degree outcomes and compatible targeting for a resolution", () => {
    const source = characterRulesCopy();
    const trip = source.actions.find((action) => action.id === "trip");
    const stand = source.actions.find((action) => action.id === "stand");
    if (trip?.resolution.kind !== "check" || !stand) throw new Error("The character rules fixture is missing action.");
    const tripResolution = trip.resolution;

    const missingDegree = {
      ...source,
      actions: source.actions.map((action) => action.id === trip.id
        ? { ...action, resolution: { ...tripResolution, outcomes: { ...tripResolution.outcomes, failure: undefined } } }
        : action),
    } as ContentPackSource;
    expect(validateContentPackStructure(missingDegree, contentPackSchema)).toContainEqual(expect.objectContaining({
      source: "actions",
      definitionId: trip.id,
    }));

    // A Direct resolution cannot target a tile, and a self Action cannot affect a target.
    const badTargeting: ContentPackSource = {
      ...source,
      actions: source.actions.map((action) => action.id === stand.id ? { ...action, targeting: "tile" as const } : action),
    };
    expect(validateContentPackSemantics(badTargeting)).toContainEqual(expect.objectContaining({
      code: "INCOMPATIBLE_TARGETING",
      definitionId: stand.id,
    }));
    const targetFromSelf: ContentPackSource = {
      ...source,
      actions: source.actions.map((action) => action.id === stand.id
        ? { ...action, resolution: { kind: "direct" as const, effects: [{ kind: "apply-condition" as const, owner: "target" as const, condition: "prone" }] } }
        : action),
    };
    expect(validateContentPackSemantics(targetFromSelf)).toContainEqual(expect.objectContaining({
      code: "EFFECT_REQUIRES_TARGET",
      definitionId: stand.id,
    }));
  });

  it("allows weapon reach only where a weapon is actually involved", () => {
    const source = characterRulesCopy();
    const strike = source.actions.find((action) => action.id === "strike");
    const spell = source.actions.find((action) => action.id === "spirit-lance");
    if (!strike || !spell) throw new Error("The character rules fixture is missing action.");
    expect(strike.range).toEqual({ kind: "weapon-reach" });
    expect(spell.range).toEqual({ kind: "feet", value: 30 });

    const reachingSpell: ContentPackSource = {
      ...source,
      actions: source.actions.map((action) => action.id === spell.id
        ? { ...action, range: { kind: "weapon-reach" as const } }
        : action),
    };
    expect(validateContentPackSemantics(reachingSpell)).toContainEqual(expect.objectContaining({
      code: "WEAPON_REACH_NOT_APPLICABLE",
      definitionId: spell.id,
    }));

    const oddRange: ContentPackSource = {
      ...source,
      actions: source.actions.map((action) => action.id === spell.id
        ? { ...action, range: { kind: "feet" as const, value: 7 } }
        : action),
    };
    expect(validateContentPackSemantics(oddRange)).toContainEqual(expect.objectContaining({
      code: "INVALID_ACTION_RANGE",
      definitionId: spell.id,
    }));
  });

  it("rejects positive untyped modifiers because PF2e untyped contributions are penalties", () => {
    const source = characterRulesCopy();
    const equipment = source.equipment.find((definition) => definition.statModifiers.length > 0);
    if (!equipment) throw new Error("M5 equipment fixtures are missing stat modifiers.");
    const invalid: ContentPackSource = {
      ...source,
      equipment: source.equipment.map((definition) => definition.id === equipment.id
        ? {
            ...definition,
            statModifiers: [
              { selector: { kind: "all" }, type: "untyped", value: 2, label: "Untyped bonus" },
              { selector: { kind: "all" }, type: "untyped", value: -1, label: "Untyped penalty" },
            ],
          }
        : definition),
    };

    expect(validateContentPackStructure(invalid, contentPackSchema)).toContainEqual(expect.objectContaining({
      source: "equipment",
      definitionId: equipment.id,
    }));
    const semantic = validateContentPackSemantics(invalid).filter(
      (issue) => issue.code === "UNTYPED_MODIFIER_MUST_BE_PENALTY",
    );
    expect(semantic).toEqual([expect.objectContaining({
      definitionId: equipment.id,
      message: 'Untyped modifier "Untyped bonus" must be a penalty (value < 0) but is 2.',
    })]);
  });
});

describe("trait vocabulary contract", () => {
  function without(trait: TraitDefinition, key: keyof TraitDefinition): object {
    return Object.fromEntries(Object.entries(trait).filter(([name]) => name !== key));
  }

  function withTrait(source: ContentPackSource, id: string, edit: (trait: TraitDefinition) => object): ContentPackSource {
    return {
      ...source,
      traits: source.traits.map((trait) => (trait.id === id ? edit(trait) as TraitDefinition : trait)),
    };
  }

  it("requires source, category and a non-empty description on every definition, by schema and by semantics", () => {
    const source = sourceCopy();
    const cases: readonly (readonly [string, (trait: TraitDefinition) => object, string])[] = [
      ["missing source", (trait) => without(trait, "source"), "INVALID_TRAIT_SOURCE"],
      ["invalid source", (trait) => ({ ...trait, source: "homebrew" }), "INVALID_TRAIT_SOURCE"],
      ["missing category", (trait) => without(trait, "category"), "INVALID_TRAIT_CATEGORY"],
      ["invalid category", (trait) => ({ ...trait, category: "spell" }), "INVALID_TRAIT_CATEGORY"],
      ["missing description", (trait) => without(trait, "description"), "EMPTY_TRAIT_DESCRIPTION"],
      ["empty description", (trait) => ({ ...trait, description: "" }), "EMPTY_TRAIT_DESCRIPTION"],
      ["blank description", (trait) => ({ ...trait, description: "   " }), "EMPTY_TRAIT_DESCRIPTION"],
    ];
    for (const [label, edit, code] of cases) {
      const invalid = withTrait(source, "agile", edit);
      const structural = validateContentPackStructure(invalid, contentPackSchema);
      // A description of spaces is a schema-legal string; the semantic pass is what refuses it.
      if (label !== "blank description") {
        expect(structural, label).toContainEqual(expect.objectContaining({ source: "traits", definitionId: "agile" }));
      }
      expect(validateContentPackSemantics(invalid), label).toContainEqual(expect.objectContaining({
        source: "traits", definitionId: "agile", code, path: expect.stringMatching(/^\[\d+\]\.(source|category|description)$/),
      }));
    }
    expect(validateContentPackStructure(source, contentPackSchema)).toEqual([]);
    expect(validateContentPackSemantics(source)).toEqual([]);
  });

  it("keeps one ID one definition even when a duplicate names a different source", () => {
    const source = sourceCopy();
    const agile = source.traits.find((trait) => trait.id === "agile")!;
    const duplicate: ContentPackSource = {
      ...source,
      traits: [...source.traits, { ...agile, source: agile.source === "cardguild" ? "pf2e-remaster" : "cardguild" }],
    };
    expect(validateContentPackSemantics(duplicate)).toContainEqual(expect.objectContaining({
      source: "traits", code: "DUPLICATE_ID", definitionId: "agile",
    }));
    expect(() => compileContentPack(duplicate)).toThrow(ContentCompilationError);
  });

  it("keeps instances free of vocabulary metadata and still refuses an unknown instance", () => {
    const source = sourceCopy();
    const halberd = source.equipment.find((item) => item.id === "halberd")!;
    const instance = halberd.traits[0]!;
    expect(Object.keys(instance).sort()).toEqual(Object.keys(instance).filter((key) => key === "id" || key === "sourceId" || key === "params").sort());
    const unknown: ContentPackSource = {
      ...source,
      equipment: source.equipment.map((item) => (item.id === "halberd" ? { ...item, traits: [{ id: "nope" }] } : item)),
    };
    expect(validateContentPackSemantics(unknown)).toContainEqual(expect.objectContaining({ code: "UNKNOWN_TRAIT", definitionId: "halberd" }));
  });

  it("leaves every rule reading trait IDs unmoved when source and category change", () => {
    const source = characterRulesCopy();
    const relabelled: ContentPackSource = {
      ...source,
      traits: source.traits.map((trait) => ({
        ...trait,
        source: trait.source === "cardguild" ? "pf2e-remaster" : "cardguild",
        category: trait.category === "general" ? "system" : "general",
        description: `relabelled ${trait.description}`,
      })),
    };
    const before = compileContentPack(source);
    const after = compileContentPack(relabelled);
    expect(after.fingerprint).not.toBe(before.fingerprint);

    // Attack, Agile MAP, finesse attribute choice, reach, provider grants and terrain cost
    // all key off `id`, so the resolved numbers are identical under either labelling.
    const hero = before.actorDefinitions["hero.aerin"] ?? Object.values(before.actorDefinitions).find((actor) => actor.statProfile.kind === "character")!;
    for (const [id, definition] of Object.entries(before.combatContent.equipment)) {
      if (!definition.weaponProfile) continue;
      const armed = (pack: typeof before) => {
        const combat = getCombatDefinition(pack, RUINED_GATE_ID);
        const setup = combat.scenario.actors.find((actor) => actor.definitionId === hero.id)!;
        const actor = { ...setup, equipmentIds: [id], reactionAvailable: true, shieldRaised: false, defeated: false };
        return { strike: resolveStrike(actor, { content: pack.combatContent }), map: resolveMapPenalty(2, resolveStrike(actor, { content: pack.combatContent }).traits) };
      };
      expect(armed(after), id).toEqual(armed(before));
    }
    const beforeCombat = createCombat(getCombatDefinition(before, RUINED_GATE_ID), 7).state;
    const afterCombat = createCombat(getCombatDefinition(after, RUINED_GATE_ID), 7).state;
    const heroId = beforeCombat.turn.initiativeOrder.find((id) => beforeCombat.actors[id]?.team === "heroes")!;
    const legal = (state: typeof beforeCombat, content: typeof before.combatContent) =>
      listLegalActions(state, heroId, content).map((action) => [action.actionId, action.source.id, action.enabled, action.traits]);
    expect(legal(afterCombat, after.combatContent)).toEqual(legal(beforeCombat, before.combatContent));
    expect(deriveLoadoutSnapshot(hero, hero.starterLoadout, after.combatContent, "m").deck)
      .toEqual(deriveLoadoutSnapshot(hero, hero.starterLoadout, before.combatContent, "m").deck);
    const reach = (state: typeof beforeCombat) =>
      findReachableTiles(state.map, state.actors, heroId, state.actors[heroId]!.position, 25, "land");
    expect(reach(afterCombat)).toEqual(reach(beforeCombat));
  });
});

describe("playable character content", () => {
  const characterRules = createCharacterRulesFixture();

  it("compiles three distinct playable profiles with validator-safe starter loadouts", () => {
    expect(validateContentPackStructure(characterRulesCopy(), contentPackSchema)).toEqual([]);
    const playable = Object.values(characterRules.actorDefinitions)
      .filter((actor) => actor.traits.some((trait) => trait.id === "playable"));
    expect(playable.map((actor) => actor.id).sort()).toEqual([
      "hero.aerin",
      "hero.brom",
      "hero.lyra",
    ]);
    const aerin = playable.find((actor) => actor.id === "hero.aerin");
    const lyra = playable.find((actor) => actor.id === "hero.lyra");
    const brom = playable.find((actor) => actor.id === "hero.brom");
    if (!aerin || !lyra || !brom) throw new Error("Playable M5 profiles are missing.");
    const aerinStats = deriveLoadoutSnapshot(aerin, aerin.starterLoadout, characterRules.combatContent, aerin.id).statistics;
    const lyraStats = deriveLoadoutSnapshot(lyra, lyra.starterLoadout, characterRules.combatContent, lyra.id).statistics;
    const bromStats = deriveLoadoutSnapshot(brom, brom.starterLoadout, characterRules.combatContent, brom.id).statistics;
    expect(lyraStats.reflex.modifier).toBeGreaterThan(aerinStats.reflex.modifier);
    expect(lyraStats.initiative).toBeGreaterThan(aerinStats.initiative);
    expect(lyra?.speedFeet).toBeGreaterThan(aerin?.speedFeet ?? 0);
    expect(lyraStats.maxHp).toBeLessThan(aerinStats.maxHp);
    expect(bromStats.maxHp).toBeGreaterThan(aerinStats.maxHp);
    expect(bromStats.ac).toBeGreaterThan(aerinStats.ac);
    expect(bromStats.athletics).toBeGreaterThan(aerinStats.athletics);
    expect(brom?.speedFeet).toBeLessThan(aerin?.speedFeet ?? 0);

    const party: PartySetup = {
      members: Object.fromEntries(playable.map((actor, index) => [
        "party.hero-" + String(index + 1),
        {
          id: "party.hero-" + String(index + 1),
          seat: index + 1 as 1 | 2 | 3,
          actorDefinitionId: actor.id,
          loadout: clonePartyLoadout(actor.starterLoadout),
        },
      ])),
    };
    const collection = createStartingCollection(party, characterRules);
    expect(validatePartyLoadout(party, collection, characterRules)).toEqual({ valid: true, issues: [] });
    expect(new Set(playable.map((actor) => JSON.stringify({
      equipment: actor.starterLoadout.equipment,
      baseCards: actor.baseCardGrants,
    }))).size).toBe(3);
  });
});

describe("content fingerprint", () => {
  it("ignores object key and definition ordering but changes for gameplay values", () => {
    const source = sourceCopy();
    const reordered: ContentPackSource = {
      manifest: {
        rulesetId: source.manifest.rulesetId,
        version: source.manifest.version,
        id: source.manifest.id,
        schemaVersion: 10,
      },
      traits: [...source.traits].reverse(),
      conditions: [...source.conditions].reverse(),
      actions: [...source.actions].reverse(),
      cards: [...source.cards].reverse(),
      equipment: [...source.equipment].reverse(),
      actors: [...source.actors].reverse(),
      scenarios: [...source.scenarios]
        .reverse()
        .map((scenario) => ({
          ...scenario,
          placements: [...scenario.placements].reverse(),
          partySpawnSlots: [...scenario.partySpawnSlots].reverse(),
          map: {
            ...scenario.map,
            tiles: [...scenario.map.tiles].reverse(),
            objects: [...scenario.map.objects].reverse(),
          },
        })),
      adventures: [...source.adventures]
        .reverse()
        .map((adventure) => ({
          ...adventure,
          rewards: [...adventure.rewards]
            .reverse()
            .map((reward) => ({ ...reward, choices: [...reward.choices] })),
          experienceAwards: [...adventure.experienceAwards].reverse().map((award) => ({ ...award })),
        })),
    };
    expect(fingerprintContentPack(reordered)).toBe(fingerprintContentPack(source));

    const changed: ContentPackSource = {
      ...source,
      equipment: source.equipment.map((item) =>
        item.id === "boots-of-fly"
          ? {
              ...item,
              statModifiers: [{
                selector: { kind: "save", id: "reflex" },
                type: "item",
                value: 2,
                label: "Boots of Fly",
              }],
            }
          : item,
      ),
    };
    expect(fingerprintContentPack(changed)).not.toBe(fingerprintContentPack(source));

    const changedCharacter: ContentPackSource = {
      ...source,
      actors: source.actors.map((actor) => actor.statProfile.kind === "character"
        ? {
            ...actor,
            statProfile: {
              kind: "character",
              stats: {
                ...actor.statProfile.stats,
                attributes: {
                  ...actor.statProfile.stats.attributes,
                  dex: actor.statProfile.stats.attributes.dex + 1,
                },
              },
            },
          }
        : actor),
    };
    expect(fingerprintContentPack(changedCharacter)).not.toBe(fingerprintContentPack(source));

    // Offense authoring is gameplay input: Strike and Class DC move with the pack identity.
    const changedOffense: ContentPackSource = {
      ...source,
      actors: source.actors.map((actor) => actor.statProfile.kind === "character"
        ? {
            ...actor,
            statProfile: {
              kind: "character",
              stats: {
                ...actor.statProfile.stats,
                offense: { ...actor.statProfile.stats.offense, classDcProficiency: "legendary" },
              },
            },
          }
        : actor),
    };
    expect(fingerprintContentPack(changedOffense)).not.toBe(fingerprintContentPack(source));

    const changedWeapon: ContentPackSource = {
      ...source,
      equipment: source.equipment.map((item) => item.weaponProfile
        ? { ...item, weaponProfile: { ...item.weaponProfile, category: "advanced" as const } }
        : item),
    };
    expect(fingerprintContentPack(changedWeapon)).not.toBe(fingerprintContentPack(source));
  });
});
