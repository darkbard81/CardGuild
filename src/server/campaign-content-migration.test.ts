import { describe, expect, it } from "vitest";

import { PRODUCTION_CONTENT } from "../content/production-content";
import type { CompiledContentPack } from "../content/content-types";
import type { TraitDefinition } from "../game";
import {
  REGISTERED_CONTENT_MIGRATIONS,
  TRAIT_VOCABULARY_MIGRATION,
  findContentMigration,
} from "./campaign-content-migration";

const PACK = PRODUCTION_CONTENT.pack;

/** The identity M9-4 migrated from, pinned here so the table cannot be checked against itself. */
const TWO_RELEASES_BACK = { packId: "cardguild.m7", packVersion: "0.3.0", fingerprint: "fnv1a64:887ee163d92faa57" };

function withTrait(pack: CompiledContentPack, id: string, edit: (trait: TraitDefinition) => TraitDefinition): CompiledContentPack {
  const trait = pack.combatContent.traits[id];
  if (!trait) throw new Error(`Trait "${id}" is not in the production pack.`);
  return { ...pack, combatContent: { ...pack.combatContent, traits: { ...pack.combatContent.traits, [id]: edit(trait) } } };
}

describe("trait vocabulary migration", () => {
  it("is the only registered migration and carries the previous production identity onto this one", () => {
    expect(REGISTERED_CONTENT_MIGRATIONS).toEqual([TRAIT_VOCABULARY_MIGRATION]);
    expect(TRAIT_VOCABULARY_MIGRATION.from).toEqual({
      packId: "cardguild.m7", packVersion: "0.4.0", fingerprint: "fnv1a64:8795c80164042fbf",
    });
    expect(TRAIT_VOCABULARY_MIGRATION.to).toEqual(PRODUCTION_CONTENT.contentIdentity);
    expect(PACK.manifest.schemaVersion).toBe(10);
    expect(PACK.manifest.version).toBe("0.5.0");
  });

  it("reproduces the v9 fingerprint from the shipped pack once the three vocabulary fields are removed", () => {
    // This is the proof that only metadata moved: 54 IDs, every grant, every stat modifier
    // and every non-Trait definition hash to exactly what 0.4.0 hashed to.
    expect(TRAIT_VOCABULARY_MIGRATION.verify(PACK)).toBe(true);
    expect(Object.keys(PACK.combatContent.traits)).toHaveLength(54);
    for (const trait of Object.values(PACK.combatContent.traits)) {
      expect(trait.source).toMatch(/^(pf2e-remaster|cardguild)$/);
      expect(trait.description.trim().length).toBeGreaterThan(0);
    }
  });

  it("refuses to carry any gameplay change along with the vocabulary change", () => {
    const changedGrant = withTrait(PACK, "trip", (trait) => ({
      ...trait, cardGrants: trait.cardGrants.map((grant) => ({ ...grant, count: grant.count + 1 })),
    }));
    expect(TRAIT_VOCABULARY_MIGRATION.verify(changedGrant)).toBe(false);

    const renamed = withTrait(PACK, "agile", (trait) => ({ ...trait, name: "Nimble" }));
    expect(TRAIT_VOCABULARY_MIGRATION.verify(renamed)).toBe(false);
    // The two labels 0.5.0 changed are put back by name, so a third rename is still caught
    // and so is a label that drifted from what 0.5.0 shipped.
    expect(PACK.combatContent.traits["grabbed"]?.name).toBe("Grabbed");
    expect(PACK.combatContent.traits["prone"]?.name).toBe("Prone");
    const relabelled = withTrait(PACK, "grabbed", (trait) => ({ ...trait, name: "Held" }));
    expect(TRAIT_VOCABULARY_MIGRATION.verify(relabelled)).toBe(true);
    const reverted = withTrait(PACK, "prone", (trait) => ({ ...trait, name: "Prone Recovery" }));
    expect(TRAIT_VOCABULARY_MIGRATION.verify(reverted)).toBe(true);

    const [actorId, actor] = Object.entries(PACK.actorDefinitions)[0]!;
    const changedActor = { ...PACK, actorDefinitions: { ...PACK.actorDefinitions, [actorId]: { ...actor, speedFeet: actor.speedFeet + 5 } } };
    expect(TRAIT_VOCABULARY_MIGRATION.verify(changedActor)).toBe(false);

    const adventure = PRODUCTION_CONTENT.adventure;
    const changedAward = { ...PACK, adventures: { ...PACK.adventures, [adventure.id]: {
      ...adventure, experienceAwards: adventure.experienceAwards.map((award) => ({ ...award, amount: award.amount + 1 })),
    } } };
    expect(TRAIT_VOCABULARY_MIGRATION.verify(changedAward)).toBe(false);

    // Metadata alone is free to differ: it is exactly what the migration is for.
    const reworded = withTrait(PACK, "agile", (trait) => ({ ...trait, description: "다른 설명", category: "general" }));
    expect(TRAIT_VOCABULARY_MIGRATION.verify(reworded)).toBe(true);
  });

  it("resolves only the immediately previous identity against the shipped pack", () => {
    expect(findContentMigration(TRAIT_VOCABULARY_MIGRATION.from, PACK)).toBe(TRAIT_VOCABULARY_MIGRATION);
    expect(findContentMigration(TWO_RELEASES_BACK, PACK)).toBeUndefined();
    expect(findContentMigration(PRODUCTION_CONTENT.contentIdentity, PACK)).toBeUndefined();
    // A pack that fails verification is not a migration target, whatever the table says.
    const drifted = withTrait(PACK, "trip", (trait) => ({ ...trait, cardGrants: [] }));
    expect(findContentMigration(TRAIT_VOCABULARY_MIGRATION.from, { ...drifted, fingerprint: PACK.fingerprint })).toBeUndefined();
  });
});
