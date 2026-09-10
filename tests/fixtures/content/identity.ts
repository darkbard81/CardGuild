import type { ContentPackManifest } from "../../../src/content";

/**
 * Fixture packs name themselves, and say so.
 *
 * `cardguild.test.*` cannot be mistaken for a shipped pack in a hash, a save or a failure
 * message, which is the point: these packs exist to make rules testable, and the moment one
 * of them is read as production content the identity is the only thing that says otherwise.
 */
export const FIXTURE_PACK_VERSION = "1.0.0";

/**
 * One place the fixture manifests are made.
 *
 * The authored version is fixed. A fixture is not released, so bumping it the way a
 * production pack is bumped would only mean "someone edited a test" — and would move every
 * fingerprint and golden hash that depends on it for no reason a reader could name.
 */
export function fixtureManifest(name: string): ContentPackManifest {
  return {
    schemaVersion: 9,
    id: `cardguild.test.${name}`,
    version: FIXTURE_PACK_VERSION,
    rulesetId: "cardguild.pf2e-remaster.v1",
  };
}

export const CORE_PACK_ID = "cardguild.test.core";
export const CHARACTER_RULES_PACK_ID = "cardguild.test.character-rules";
