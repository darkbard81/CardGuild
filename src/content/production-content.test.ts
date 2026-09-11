import { describe, expect, it } from "vitest";

import { getContentIdentity } from "./compile-content";
import { createCharacterRulesContentSource } from "../../tests/fixtures/content";
import { compileContentPack } from "./compile-content";
import { TRAIT_CATEGORIES, TRAIT_SOURCES } from "../game/traits";
import { M7_ADVENTURE_ID, M7_COMPILED_PACK } from "./load-m7-content";
import { PRODUCTION_CONTENT } from "./production-content";

describe("production content selector", () => {
  it("points at the M7 pack identity", () => {
    expect(PRODUCTION_CONTENT.pack.manifest.id).toBe("cardguild.m7");
    // The authored revision is not pinned here. It moves with every gameplay data change,
    // and a second copy of it would turn a routine content edit into a surprise test failure.
    expect(PRODUCTION_CONTENT.pack.manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(PRODUCTION_CONTENT.pack.manifest.schemaVersion).toBe(10);
    expect(PRODUCTION_CONTENT.pack.manifest.rulesetId).toBe("cardguild.pf2e-remaster.v1");
  });

  it("resolves the selected adventure out of the selected pack", () => {
    expect(PRODUCTION_CONTENT.adventure.id).toBe(PRODUCTION_CONTENT.adventureId);
    expect(PRODUCTION_CONTENT.pack.adventures[PRODUCTION_CONTENT.adventureId]).toBe(PRODUCTION_CONTENT.adventure);
    expect(PRODUCTION_CONTENT.adventureId).toBe(M7_ADVENTURE_ID);
  });

  it("derives the content identity from the selected pack", () => {
    expect(PRODUCTION_CONTENT.contentIdentity).toEqual(getContentIdentity(PRODUCTION_CONTENT.pack));
    expect(PRODUCTION_CONTENT.contentIdentity.packId).toBe("cardguild.m7");
    expect(PRODUCTION_CONTENT.contentIdentity.packVersion).toBe(PRODUCTION_CONTENT.pack.manifest.version);
    expect(PRODUCTION_CONTENT.contentIdentity.fingerprint).toBe(PRODUCTION_CONTENT.pack.fingerprint);
  });

  it("selects the M7 pack itself rather than a copy", () => {
    expect(PRODUCTION_CONTENT.pack).toBe(M7_COMPILED_PACK);
  });

  it("compiles independently of the rules fixtures it grew out of", () => {
    // The shipped pack bootstrapped from a fixture snapshot but is self-contained: it has
    // no inheritance link, and its distinct identity yields a distinct fingerprint.
    const fixture = compileContentPack(createCharacterRulesContentSource());
    expect(fixture.manifest.id).toBe("cardguild.test.character-rules");
    expect(PRODUCTION_CONTENT.pack.manifest.id).not.toMatch(/^cardguild\.test\./);
    expect(PRODUCTION_CONTENT.pack.fingerprint).not.toBe(fixture.fingerprint);
    expect(Object.keys(PRODUCTION_CONTENT.pack.adventures)).toEqual(Object.keys(fixture.adventures));
  });
});

describe("production trait vocabulary", () => {
  const traits = Object.values(PRODUCTION_CONTENT.pack.combatContent.traits);

  it("carries source, category and a description on every shipped Trait", () => {
    expect(traits).toHaveLength(54);
    for (const trait of traits) {
      expect(TRAIT_SOURCES, trait.id).toContain(trait.source);
      expect(TRAIT_CATEGORIES, trait.id).toContain(trait.category);
      expect(trait.description.trim(), trait.id).toBe(trait.description);
      expect(trait.description.length, trait.id).toBeGreaterThan(0);
    }
  });

  it("classifies terrain and system markers and CardGuild-only meanings as CardGuild vocabulary", () => {
    const cardguild = new Set(traits.filter((trait) => trait.source === "cardguild").map((trait) => trait.id));
    for (const trait of traits) {
      if (trait.category === "terrain" || trait.category === "system") {
        expect(cardguild.has(trait.id), trait.id).toBe(true);
      }
    }
    // The Remaster `open` Trait orders attacks; CardGuild's `open` is a floor tile.
    expect(PRODUCTION_CONTENT.pack.combatContent.traits["open"]).toMatchObject({ source: "cardguild", category: "terrain" });
  });

  it("keeps provenance apart from provider behaviour: a Remaster weapon Trait stays Remaster when CardGuild makes it grant cards", () => {
    // `trip` and `parry` are Player Core weapon Traits; their cardGrants say what CardGuild
    // does with them, not where the word came from.
    expect(PRODUCTION_CONTENT.pack.combatContent.traits["trip"]).toMatchObject({ source: "pf2e-remaster", category: "weapon" });
    expect(PRODUCTION_CONTENT.pack.combatContent.traits["parry"]).toMatchObject({ source: "pf2e-remaster", category: "weapon" });
    expect(PRODUCTION_CONTENT.pack.combatContent.traits["trip"]?.cardGrants.length).toBeGreaterThan(0);
    // Whereas a provider CardGuild invented outright is CardGuild's.
    expect(PRODUCTION_CONTENT.pack.combatContent.traits["field-medicine"]).toMatchObject({ source: "cardguild" });
    // Names are the chip labels now, so a Condition Trait is named after the Condition.
    expect(PRODUCTION_CONTENT.pack.combatContent.traits["grabbed"]?.name).toBe("Grabbed");
    expect(PRODUCTION_CONTENT.pack.combatContent.traits["prone"]?.name).toBe("Prone");
  });

  it("marks as PF2e Remaster only the vocabulary whose current meaning matches the Remaster Trait", () => {
    const remaster = traits.filter((trait) => trait.source === "pf2e-remaster").map((trait) => trait.id).sort();
    expect(remaster).toEqual([
      "agile", "attack", "cantrip", "cold", "concentrate", "emotion", "fear", "finesse", "fire", "flourish",
      "focus", "goblin", "healing", "manipulate", "mental", "move", "parry", "propulsive", "reach", "skill",
      "thrown", "trip", "undead", "vitality", "void",
    ]);
  });
});
