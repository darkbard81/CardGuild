import { describe, expect, it } from "vitest";

import contentPackSchema from "../../content/schema/content-pack.schema.json";
import { createCombat, dispatchCombatCommand } from "../game/engine";
import { listLegalActions } from "../game/queries";
import type { CombatCommand } from "../game/types";
import { compileContentPack, getCombatDefinition } from "./compile-content";
import type { ContentPackSource } from "./content-types";
import { fingerprintContentPack } from "./fingerprint";
import { M0_CONTENT_SOURCE, M0_SCENARIO_ID } from "./load-m0-content";
import { validateContentPackStructure } from "./validate-content";
import { formatContentValidationIssue, validateContentPackSemantics } from "./validate-semantics";

function sourceCopy(): ContentPackSource {
  return structuredClone(M0_CONTENT_SOURCE);
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
      "Pack: cardguild.m0\nSource: content/test/manifest.json",
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
        "Pack: cardguild.m0",
        "Source: content/test/equipment.json",
        "Definition: halberd",
        "Path: [0].traits[0].id",
        'UNKNOWN_TRAIT: Trait "tirp" is not defined.',
      ].join("\n"),
    );
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
          traits: [{ id: "trip" }, { id: "fly" }, { id: "shield" }],
          statModifiers: [],
          shieldBonus: 2,
        },
      ],
      actors: source.actors.map((actor) =>
        actor.id === "hero"
          ? {
              ...actor,
              initiativeModifier: 100,
              equipmentIds: ["trait-only-kit"],
              conditions: [{ id: "custom-condition", sourceId: "test" }],
            }
          : { ...actor, initiativeModifier: -100 },
      ),
    };
    const authoredJson = JSON.parse(JSON.stringify(custom)) as unknown;
    expect(validateContentPackStructure(authoredJson, contentPackSchema)).toEqual([]);
    const pack = compileContentPack(authoredJson as ContentPackSource);
    const definition = getCombatDefinition(pack, M0_SCENARIO_ID);
    const setup = createCombat(definition, 72);
    const allCards = Object.values(setup.state.cardZones.hero ?? {}).flat() as readonly {
      readonly definitionId: string;
      readonly source: { readonly objectId: string; readonly traitId?: string };
    }[];

    expect(allCards.filter((card) => card.definitionId === "card.trip")).toHaveLength(3);
    expect(allCards.filter((card) => card.definitionId === "card.fly")).toHaveLength(2);
    expect(
      allCards
        .filter((card) => card.definitionId === "card.trip" || card.definitionId === "card.fly")
        .every((card) => card.source.objectId === "trait-only-kit" && card.source.traitId !== undefined),
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
});

describe("content fingerprint", () => {
  it("ignores object key and definition ordering but changes for gameplay values", () => {
    const source = sourceCopy();
    const reordered: ContentPackSource = {
      manifest: {
        rulesetId: source.manifest.rulesetId,
        version: source.manifest.version,
        id: source.manifest.id,
        schemaVersion: 1,
      },
      traits: [...source.traits].reverse(),
      conditions: [...source.conditions].reverse(),
      actions: [...source.actions].reverse(),
      cards: [...source.cards].reverse(),
      equipment: [...source.equipment].reverse(),
      actors: [...source.actors].reverse(),
      scenario: {
        ...source.scenario,
        map: {
          ...source.scenario.map,
          tiles: [...source.scenario.map.tiles].reverse(),
          objects: [...source.scenario.map.objects].reverse(),
        },
      },
    };
    expect(fingerprintContentPack(reordered)).toBe(fingerprintContentPack(source));

    const changed: ContentPackSource = {
      ...source,
      equipment: source.equipment.map((item) =>
        item.id === "boots-of-fly"
          ? { ...item, statModifiers: [{ selector: "reflex", value: 2, label: "Boots of Fly" }] }
          : item,
      ),
    };
    expect(fingerprintContentPack(changed)).not.toBe(fingerprintContentPack(source));
  });
});
