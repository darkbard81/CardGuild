import { describe, expect, it } from "vitest";
import schema from "../../content/schema/content-pack.schema.json";
import { createCoreContentSource } from "../../tests/fixtures/content";
import { deriveLoadoutSnapshot } from "../loadout";
import { applyCharacterAdvancement, resolveCharacterRules } from "../character";
import { compileContentPack } from "./compile-content";
import { isCharacterActorSource, type ContentPackSource } from "./content-types";
import { fingerprintContentPack } from "./fingerprint";
import { PRODUCTION_CONTENT } from "./production-content";
import { validateContentPackStructure } from "./validate-content";
import { validateContentPackSemantics } from "./validate-semantics";

function npcSource(): ContentPackSource {
  const source = createCoreContentSource();
  const hero = source.actors.find(isCharacterActorSource)!;
  return { ...source, actors: [...source.actors, { ...hero, id: "npc.scholar", traits: hero.traits.filter(t => t.id !== "playable"),
    statProfile: { ...hero.statProfile, level: 5, advancements: [
      { level: 3, skillIncrease: "athletics" },
      { level: 5, skillIncrease: "medicine", attributeBoosts: ["str", "dex", "con", "wis"] },
    ] } }] };
}

describe("Character authoring is a Build, for playable and NPC sources alike", () => {
  it("compiles a complete non-playable NPC through exactly the standalone user Character resolver", () => {
    const source = npcSource();
    expect(validateContentPackStructure(source, schema)).toEqual([]);
    expect(validateContentPackSemantics(source)).toEqual([]);
    const pack = compileContentPack(source);
    const npc = pack.actorDefinitions["npc.scholar"]!;
    expect(npc.character).toBeDefined();
    const user = resolveCharacterRules({ traits: npc.traits, build: npc.character!.build,
      progression: { level: 5, experience: 0, advancements: npc.character!.advancements } }, pack.characterRules);
    expect(user.statProfile).toEqual(npc.statProfile);
    expect(user.speedFeet).toBe(npc.speedFeet);
    expect(source.actors.find(a => a.id === npc.id)).not.toHaveProperty("speedFeet");
  });

  it("rejects missing, duplicate and unresolved identities on NPCs, and incomplete authored growth", () => {
    const source = npcSource();
    const npc = source.actors.find(a => a.id === "npc.scholar")!;
    if (!isCharacterActorSource(npc)) throw new Error("Expected NPC Build.");
    for (const invalid of [
      { ...npc, traits: npc.traits.filter(t => t.id !== "fighter") },
      { ...npc, traits: [...npc.traits, { id: "fighter" }] },
      { ...npc, traits: [...npc.traits.filter(t => t.id !== "fighter"), { id: "unknown-class" }] },
      { ...npc, statProfile: { ...npc.statProfile, advancements: [] } },
    ]) expect(validateContentPackSemantics({ ...source, actors: [...source.actors.filter(a => a.id !== npc.id), invalid] }))
      .toContainEqual(expect.objectContaining({ source: "actors", definitionId: npc.id }));
    for (const field of ["stats", "speedFeet"]) {
      const invalid = field === "stats" ? { ...npc, statProfile: { ...npc.statProfile, stats: {} } } : { ...npc, speedFeet: 25 };
      expect(validateContentPackStructure({ ...source, actors: [invalid] }, schema).length).toBeGreaterThan(0);
    }
  });

  it("rejects registry duplicates and incomplete tables while ancestry-tagged Creatures remain fixed", () => {
    const source = npcSource();
    expect(validateContentPackSemantics({ ...source, classes: [...source.classes, source.classes[0]!] })).toContainEqual(expect.objectContaining({ code: "DUPLICATE_ID" }));
    const creature = source.actors.find(a => a.statProfile.kind === "creature")!;
    const pack = compileContentPack(source);
    expect(pack.actorDefinitions[creature.id]!.statProfile).toEqual(creature.statProfile);
    const goblins = Object.values(PRODUCTION_CONTENT.pack.actorDefinitions).filter(a => a.statProfile.kind === "creature" && a.traits.some(t => t.id === "goblin"));
    expect(goblins.length).toBeGreaterThan(0);
    expect(goblins.every(a => !a.character)).toBe(true);
  });

  it("normalizes all order-independent build choices and class milestone order in the fingerprint", () => {
    const source = npcSource();
    const reordered: ContentPackSource = { ...source,
      ancestries: [...source.ancestries].reverse().map(a => ({ ...a, fixedBoosts: [...a.fixedBoosts].reverse() as unknown as typeof a.fixedBoosts })),
      classes: [...source.classes].reverse().map(c => ({ ...c, milestones: [...c.milestones].reverse() })),
      actors: [...source.actors].reverse().map(a => !isCharacterActorSource(a) ? a : { ...a, statProfile: { ...a.statProfile,
        build: { freeBoosts: [...a.statProfile.build.freeBoosts].reverse() as unknown as typeof a.statProfile.build.freeBoosts,
          trainedSkills: [...a.statProfile.build.trainedSkills].reverse() },
        advancements: [...a.statProfile.advancements].reverse().map(c => ({ ...c, ...(c.attributeBoosts ? {
          attributeBoosts: [...c.attributeBoosts].reverse() as unknown as typeof c.attributeBoosts,
        } : {}) })),
      } }),
    };
    expect(fingerprintContentPack(reordered)).toBe(fingerprintContentPack(source));
    expect(compileContentPack(reordered).actorDefinitions).toEqual(compileContentPack(source).actorDefinitions);
  });
});

describe("approved production classes and Builds", () => {
  const pack = PRODUCTION_CONTENT.pack;
  it("ships Player Core eight plus Champion only", () => {
    expect(Object.keys(pack.characterRules.classes).sort()).toEqual(["bard", "champion", "cleric", "druid", "fighter", "ranger", "rogue", "witch", "wizard"]);
    expect(pack.actorDefinitions["hero.brom"]!.traits).toEqual(expect.arrayContaining([{ id: "dwarf" }, { id: "champion" }]));
  });
  it.each([
    ["hero.aerin", [3, 1, 1, 0, 2, 0], "athletics", "expert"],
    ["hero.lyra", [0, 3, 1, 2, 1, 0], "acrobatics", "expert"],
    ["hero.brom", [2, 0, 2, 0, 2, 1], "athletics", "trained"],
    ["hero.nera", [1, 1, 1, 1, 3, 0], "medicine", "trained"],
  ] as const)("resolves %s at Lv1, Lv3, Lv5 from choices", (id, attributes, skill, perceptionAtFive) => {
    const actor = pack.actorDefinitions[id]!;
    const input = { traits: actor.traits, build: actor.character!.build };
    let progression = { level: 1, experience: 0, advancements: [] } as import("../character").CharacterProgressionState;
    const snapshot = (progression: import("../character").CharacterProgressionState): void => {
      const resolved = resolveCharacterRules({ ...input, progression }, pack.characterRules);
      const view = deriveLoadoutSnapshot(actor, actor.starterLoadout, pack.combatContent, actor.id, resolved.statProfile);
      expect({ profile: resolved.statProfile, speedFeet: resolved.speedFeet, partial: resolved.partialAttributeBoosts,
        statistics: view.statistics, strike: { rank: view.strike.proficiencyRank, modifier: view.strike.attackModifier, damage: view.strike.damage.flatModifier } })
        .toMatchSnapshot(`${id} Lv.${progression.level}`);
    };
    snapshot(progression);
    const one = resolveCharacterRules({ ...input, progression }, pack.characterRules);
    expect([one.statProfile.stats.attributes.str, one.statProfile.stats.attributes.dex, one.statProfile.stats.attributes.con,
      one.statProfile.stats.attributes.int, one.statProfile.stats.attributes.wis, one.statProfile.stats.attributes.cha]).toEqual(attributes);
    progression = applyCharacterAdvancement({ ...progression, level: 3 }, { level: 3, skillIncrease: skill }, input, pack.characterRules);
    expect(resolveCharacterRules({ ...input, progression }, pack.characterRules).statProfile.stats.skills[skill]).toBe("expert");
    snapshot(progression);
    progression = applyCharacterAdvancement({ ...progression, level: 5 }, { level: 5, skillIncrease: "nature", attributeBoosts: ["str", "dex", "con", "wis"] }, input, pack.characterRules);
    snapshot(progression);
    const five = resolveCharacterRules({ ...input, progression }, pack.characterRules).statProfile.stats;
    expect(five.attributes.str).toBe(attributes[0] + 1);
    expect(five.skills.nature).toBe("trained");
    expect(five.perception).toBe(id === "hero.nera" ? "expert" : perceptionAtFive);
    expect(actor.statProfile).toEqual(one.statProfile);
  });
});
