import { describe, expect, it } from "vitest";

import { getContentIdentity } from "./compile-content";
import { createCharacterRulesContentSource } from "../../tests/fixtures/content";
import { compileContentPack } from "./compile-content";
import { M7_ADVENTURE_ID, M7_COMPILED_PACK } from "./load-m7-content";
import { PRODUCTION_CONTENT } from "./production-content";

describe("production content selector", () => {
  it("points at the M7 pack identity", () => {
    expect(PRODUCTION_CONTENT.pack.manifest.id).toBe("cardguild.m7");
    // The authored revision is not pinned here. It moves with every gameplay data change,
    // and a second copy of it would turn a routine content edit into a surprise test failure.
    expect(PRODUCTION_CONTENT.pack.manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(PRODUCTION_CONTENT.pack.manifest.schemaVersion).toBe(9);
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
