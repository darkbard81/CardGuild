import { describe, expect, it } from "vitest";

import contentPackSchema from "../../content/schema/content-pack.schema.json";
import {
  CHARACTER_RULES_PACK_ID,
  CORE_PACK_ID,
  FIXTURE_PACK_VERSION,
  JSON_PACK_ID,
  RUINED_GATE_ID,
  createCharacterRulesContentSource,
  createCharacterRulesFixture,
  createCoreContentSource,
  createCoreRulesFixture,
  createJsonPackFiles,
  createJsonPackSource,
  createTacticalCombatFixture,
} from "../../tests/fixtures/content";
import { createCombat } from "../game";
import { compileContentPack, getCombatDefinition } from "./compile-content";
import type { ContentPackSource } from "./content-types";
import { validateContentPackStructure } from "./validate-content";
import { validateContentPackSemantics } from "./validate-semantics";

/**
 * What the test fixtures promise.
 *
 * These factories are what almost every rules test now stands on, so the promises are worth
 * holding directly rather than inferring from whichever test happens to break first: calls
 * are independent, a hand-assembled battle is the battle the compiler would have produced,
 * and a fixture always says it is a fixture.
 */
describe("rules fixture factories", () => {
  it("hands every call its own object graph", () => {
    const first = createCoreRulesFixture();
    const second = createCoreRulesFixture();
    const hero = first.actorDefinitions["hero.aerin"];
    if (!hero) throw new Error("The core fixture has no hero.");

    // Reaching deep is the point: a shallow copy would share this array.
    (hero.starterLoadout.preparedCards as string[]).push("card.trip");
    (hero.traits as { id: string }[]).push({ id: "tampered" });
    (first.combatContent.actions as Record<string, unknown>)["strike"] = null;

    const untouched = second.actorDefinitions["hero.aerin"];
    expect(untouched?.starterLoadout.preparedCards).not.toContain("card.trip");
    expect(untouched?.traits.map((trait) => trait.id)).not.toContain("tampered");
    expect(second.combatContent.actions["strike"]).toBeDefined();
    // A third call is not poisoned by either of the first two.
    expect(createCoreRulesFixture().actorDefinitions["hero.aerin"]?.traits.map((trait) => trait.id))
      .not.toContain("tampered");
  });

  it("builds the same battle the compiler would, without compiling a pack", () => {
    for (const [rules, source] of [
      ["core", createCoreContentSource()],
      ["character-rules", createCharacterRulesContentSource()],
    ] as const) {
      const built = createTacticalCombatFixture({ rules });
      const compiled = getCombatDefinition(compileContentPack(source), RUINED_GATE_ID);

      // Everything a battle reads is identical; only the identity is derived differently.
      expect(built.scenario).toEqual(compiled.scenario);
      expect(built.content).toEqual(compiled.content);
      // And the two really do fight the same, down to the RNG stream.
      const fromFixture = createCombat(built, 33).state;
      const fromPack = createCombat(compiled, 33).state;
      expect({ ...fromFixture, contentIdentity: null, setupFingerprint: "" })
        .toEqual({ ...fromPack, contentIdentity: null, setupFingerprint: "" });
    }
  });

  it("names itself a fixture in every identity it produces", () => {
    const core = compileContentPack(createCoreContentSource());
    const characterRules = compileContentPack(createCharacterRulesContentSource());
    expect(core.manifest.id).toBe(CORE_PACK_ID);
    expect(characterRules.manifest.id).toBe(CHARACTER_RULES_PACK_ID);
    for (const manifest of [core.manifest, characterRules.manifest]) {
      expect(manifest.id).toMatch(/^cardguild\.test\./);
      expect(manifest.version).toBe(FIXTURE_PACK_VERSION);
    }
    // The two rule sets are different content, so they cannot share a fingerprint.
    expect(core.fingerprint).not.toBe(characterRules.fingerprint);

    // A combat fixture is fingerprinted from the rules it fights under, not from a pack.
    const coreCombat = createTacticalCombatFixture();
    const characterCombat = createTacticalCombatFixture({ rules: "character-rules" });
    expect(coreCombat.contentIdentity.packId).toBe(CORE_PACK_ID);
    expect(characterCombat.contentIdentity.packId).toBe(CHARACTER_RULES_PACK_ID);
    expect(coreCombat.contentIdentity.fingerprint).not.toBe(characterCombat.contentIdentity.fingerprint);
    // Same rules, same identity — a battle on a different board is still the same content.
    expect(createTacticalCombatFixture({ scenarioId: "encounter.road-ambush" }).contentIdentity)
      .toEqual(coreCombat.contentIdentity);
  });

  it("keeps the character rules an extension of the core rules", () => {
    const core = createCoreRulesFixture();
    const characterRules = createCharacterRulesFixture();

    // Everything core authors is still there, unchanged apart from the three deliberate edits.
    for (const id of Object.keys(core.combatContent.equipment)) {
      expect(characterRules.combatContent.equipment[id]).toEqual(core.combatContent.equipment[id]);
    }
    expect(Object.keys(characterRules.actorDefinitions)).toEqual(
      expect.arrayContaining(Object.keys(core.actorDefinitions)));

    // Edit one: the shared hero becomes pickable and wears armor.
    expect(core.actorDefinitions["hero.aerin"]?.traits.map((trait) => trait.id)).not.toContain("playable");
    expect(characterRules.actorDefinitions["hero.aerin"]?.traits.map((trait) => trait.id)).toContain("playable");
    expect(core.actorDefinitions["hero.aerin"]?.starterLoadout.equipment.armor).toBeUndefined();
    expect(characterRules.actorDefinitions["hero.aerin"]?.starterLoadout.equipment.armor).toBe("scale-mail");
    // Edit two: the focus Action becomes a spell.
    expect(core.combatContent.actions["spirit-beacon"]?.traits.map((trait) => trait.id)).not.toContain("spell");
    expect(characterRules.combatContent.actions["spirit-beacon"]?.traits.map((trait) => trait.id)).toContain("spell");
    // Edit three: the second reward offers the added card.
    const rewardCard = (source: ContentPackSource): string | undefined => source.adventures[0]?.rewards
      .find((reward) => reward.afterEncounterId === "encounter.ruined-gate")?.choices
      .find((choice) => choice.kind === "card")?.definitionId;
    expect(rewardCard(createCoreContentSource())).toBe("card.spirit-beacon");
    expect(rewardCard(createCharacterRulesContentSource())).toBe("card.spirit-lance");

    // And three playable Characters is what the character rules exist for.
    const playable = Object.values(characterRules.actorDefinitions)
      .filter((actor) => actor.traits.some((trait) => trait.id === "playable"));
    expect(playable).toHaveLength(3);
  });

  it("awards no experience, so a fixture Adventure never depends on the shipped EXP table", () => {
    for (const source of [createCoreContentSource(), createCharacterRulesContentSource()]) {
      const adventure = source.adventures[0];
      if (!adventure) throw new Error("The fixture Adventure is missing.");
      expect(adventure.experienceAwards.map((award) => award.amount)).toEqual([0, 0, 0]);
      expect(adventure.experienceAwards.map((award) => award.afterEncounterId).sort())
        .toEqual([...adventure.encounterIds].sort());
    }
  });
});

describe("the JSON fixture pack", () => {
  it("passes the same structural, semantic and compile path a shipped pack does", () => {
    const source = createJsonPackSource();
    expect(validateContentPackStructure(source, contentPackSchema)).toEqual([]);
    expect(validateContentPackSemantics(source as ContentPackSource)).toEqual([]);

    const pack = compileContentPack(source as ContentPackSource);
    expect(pack.manifest.id).toBe(JSON_PACK_ID);
    expect(pack.manifest.schemaVersion).toBe(9);
    expect(pack.fingerprint).toMatch(/^fnv1a64:[0-9a-f]{16}$/);
    // Small enough to read, complete enough to fight on.
    expect(Object.keys(pack.actorDefinitions)).toHaveLength(2);
    expect(createCombat(getCombatDefinition(pack, "encounter.probe"), 5).state.turn.initiativeOrder).toHaveLength(2);
  });

  it("is still refused for the same reasons a shipped pack would be", () => {
    const files = createJsonPackFiles();

    // A wrong schema version is turned away before anything is interpreted.
    const legacy = { ...files, manifest: { ...(files.manifest as object), schemaVersion: 8 } };
    expect(validateContentPackStructure(legacy, contentPackSchema)
      .some((issue) => issue.path.endsWith("/schemaVersion"))).toBe(true);

    // A missing required field is structural, not semantic.
    const actors = files.actors as { id: string }[];
    const nameless = actors.map((actor, index) => index === 0
      ? Object.fromEntries(Object.entries(actor).filter(([key]) => key !== "name"))
      : actor);
    expect(validateContentPackStructure({ ...files, actors: nameless }, contentPackSchema)
      .some((issue) => issue.path.endsWith("/name"))).toBe(true);

    // A dangling reference passes the schema and is caught by semantics.
    const scenarios = files.scenarios as { placements: { actorDefinitionId: string }[] }[];
    const dangling = structuredClone(scenarios);
    const placement = dangling[0]?.placements[0];
    if (!placement) throw new Error("The JSON fixture pack has no placement to break.");
    placement.actorDefinitionId = "enemy.does-not-exist";
    const broken = { ...files, scenarios: dangling };
    expect(validateContentPackStructure(broken, contentPackSchema)).toEqual([]);
    expect(validateContentPackSemantics(broken as unknown as ContentPackSource)
      .map((issue) => issue.code)).toContain("UNKNOWN_ACTOR");
  });
});
