import { describe, expect, it } from "vitest";
import { PRODUCTION_CONTENT } from "../content/production-content";
import { REGISTERED_CONTENT_MIGRATIONS, findContentMigration } from "./campaign-content-migration";

describe("Character Build release compatibility", () => {
  it("does not reinterpret previous final-stat packs as legal Builds", () => {
    expect(REGISTERED_CONTENT_MIGRATIONS).toEqual([]);
    for (const [packVersion, fingerprint] of [
      ["0.3.0", "fnv1a64:887ee163d92faa57"], ["0.4.0", "fnv1a64:8795c80164042fbf"],
      ["0.5.0", "fnv1a64:aab2c37c8ccb6f4c"],
      ["0.6.0", "fnv1a64:75ca529c9c9d0ec5"],
    ]) expect(findContentMigration({ packId: "cardguild.m7", packVersion: packVersion!, fingerprint: fingerprint! }, PRODUCTION_CONTENT.pack)).toBeUndefined();
    expect(PRODUCTION_CONTENT.pack.manifest).toMatchObject({ schemaVersion: 11, version: "0.7.0" });
  });
});
