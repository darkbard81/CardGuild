import { describe, expect, it } from "vitest";

import contentPackSchema from "../../content/schema/content-pack.schema.json";
import type { PartyState } from "../adventure";
import { createCombat, dispatchCombatCommand } from "../game/engine";
import { listLegalActions } from "../game/queries";
import type { CombatCommand } from "../game/types";
import {
  clonePartyLoadout,
  createStartingCollection,
  deriveLoadoutSnapshot,
  validatePartyLoadout,
} from "../loadout";
import { compileContentPack, getCombatDefinition } from "./compile-content";
import type { ActorDefinition, ContentPackSource } from "./content-types";
import { fingerprintContentPack } from "./fingerprint";
import { M0_CONTENT_SOURCE, M0_SCENARIO_ID } from "./load-m0-content";
import { M6_COMPILED_PACK, M6_CONTENT_SOURCE } from "./load-m6-content";
import { validateContentPackStructure } from "./validate-content";
import { formatContentValidationIssue, validateContentPackSemantics } from "./validate-semantics";

function sourceCopy(): ContentPackSource {
  return structuredClone(M0_CONTENT_SOURCE);
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
  it("accepts the M0 pack and rejects missing fields, invalid unions, and numeric ranges", () => {
    expect(validateContentPackStructure(M0_CONTENT_SOURCE, contentPackSchema)).toEqual([]);

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
      "Pack: cardguild.m4\nSource: content/test/manifest.json",
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
        "Pack: cardguild.m4",
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
          effect: { kind: "remove-condition", condition: "custom-condition" },
        },
      ],
      traits: [
        ...source.traits,
        {
          id: "custom-recovery",
          name: "Custom Recovery",
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
    const definition = getCombatDefinition(pack, M0_SCENARIO_ID);
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
    const source = structuredClone(M6_CONTENT_SOURCE);
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
    const source = structuredClone(M6_CONTENT_SOURCE);
    const playable = source.actors.find((actor) => actor.traits.some((trait) => trait.id === "playable"));
    const creature = source.actors.find((actor) => actor.statProfile.kind === "creature");
    if (!playable || !creature || creature.statProfile.kind !== "creature") {
      throw new Error("M6 actor fixtures are missing.");
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
    const source = structuredClone(M6_CONTENT_SOURCE);
    const armor = source.equipment.find((definition) => definition.slot === "armor");
    const boots = source.equipment.find((definition) => definition.slot === "feet");
    if (!armor || !boots) throw new Error("M6 equipment fixtures are missing.");

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
    const source = structuredClone(M6_CONTENT_SOURCE);
    const boots = source.equipment.find((definition) => definition.slot === "feet");
    const shield = source.equipment.find((definition) => definition.shieldBonus !== undefined);
    if (!boots || !shield) throw new Error("M6 equipment fixtures are missing.");
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

  it("rejects positive untyped modifiers because PF2e untyped contributions are penalties", () => {
    const source = structuredClone(M6_CONTENT_SOURCE);
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

describe("M5 playable character content", () => {
  it("compiles three distinct playable profiles with validator-safe starter loadouts", () => {
    expect(validateContentPackStructure(M6_CONTENT_SOURCE, contentPackSchema)).toEqual([]);
    const playable = Object.values(M6_COMPILED_PACK.actorDefinitions)
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
    const aerinStats = deriveLoadoutSnapshot(aerin, aerin.starterLoadout, M6_COMPILED_PACK.combatContent, aerin.id).statistics;
    const lyraStats = deriveLoadoutSnapshot(lyra, lyra.starterLoadout, M6_COMPILED_PACK.combatContent, lyra.id).statistics;
    const bromStats = deriveLoadoutSnapshot(brom, brom.starterLoadout, M6_COMPILED_PACK.combatContent, brom.id).statistics;
    expect(lyraStats.reflex.modifier).toBeGreaterThan(aerinStats.reflex.modifier);
    expect(lyraStats.initiative).toBeGreaterThan(aerinStats.initiative);
    expect(lyra?.speedFeet).toBeGreaterThan(aerin?.speedFeet ?? 0);
    expect(lyraStats.maxHp).toBeLessThan(aerinStats.maxHp);
    expect(bromStats.maxHp).toBeGreaterThan(aerinStats.maxHp);
    expect(bromStats.ac).toBeGreaterThan(aerinStats.ac);
    expect(bromStats.athletics).toBeGreaterThan(aerinStats.athletics);
    expect(brom?.speedFeet).toBeLessThan(aerin?.speedFeet ?? 0);

    const party: PartyState = {
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
    const collection = createStartingCollection(party, M6_COMPILED_PACK);
    expect(validatePartyLoadout(party, collection, M6_COMPILED_PACK)).toEqual({ valid: true, issues: [] });
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
        schemaVersion: 6,
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
  });
});
