import { describe, expect, it } from "vitest";

import { getContentIdentity } from "./compile-content";
import { M6_COMPILED_PACK } from "./load-m6-content";
import { M7_ADVENTURE_ID, M7_COMPILED_PACK } from "./load-m7-content";
import { PRODUCTION_CONTENT } from "./production-content";

describe("production content selector", () => {
  it("points at the M7 pack identity", () => {
    expect(PRODUCTION_CONTENT.pack.manifest.id).toBe("cardguild.m7");
    expect(PRODUCTION_CONTENT.pack.manifest.version).toBe("0.3.0");
    expect(PRODUCTION_CONTENT.pack.manifest.schemaVersion).toBe(8);
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
    expect(PRODUCTION_CONTENT.contentIdentity.packVersion).toBe("0.3.0");
    expect(PRODUCTION_CONTENT.contentIdentity.fingerprint).toBe(PRODUCTION_CONTENT.pack.fingerprint);
  });

  it("selects the M7 pack itself rather than a copy", () => {
    expect(PRODUCTION_CONTENT.pack).toBe(M7_COMPILED_PACK);
  });

  it("compiles M7 independently of the M6 regression fixture", () => {
    // M7 bootstrapped from an M6 snapshot but is a self-contained pack: it has no
    // inheritance link, and its distinct identity yields a distinct fingerprint.
    expect(M6_COMPILED_PACK.manifest.id).toBe("cardguild.m6");
    expect(PRODUCTION_CONTENT.pack.fingerprint).not.toBe(M6_COMPILED_PACK.fingerprint);
    expect(Object.keys(PRODUCTION_CONTENT.pack.adventures)).toEqual(Object.keys(M6_COMPILED_PACK.adventures));
  });
});
