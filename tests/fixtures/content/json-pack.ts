import actions from "./json-pack/actions.json";
import actors from "./json-pack/actors.json";
import adventures from "./json-pack/adventures.json";
import cards from "./json-pack/cards.json";
import conditions from "./json-pack/conditions.json";
import equipment from "./json-pack/equipment.json";
import manifest from "./json-pack/manifest.json";
import scenarios from "./json-pack/scenarios.json";
import traits from "./json-pack/traits.json";
import { assembleContentPackSource } from "../../../src/content/content-types";
import type { ContentPackFiles } from "../../../src/content";

/**
 * The one fixture that is still authored as JSON.
 *
 * Everything else is TypeScript, which is what makes the rest of the fixtures readable and
 * type-checked — but it also means nothing would exercise the boundary the real packs
 * actually cross: files on disk, parsed as untyped JSON, and refused by the schema before a
 * single type exists. This pack is deliberately the smallest thing that still compiles —
 * one hero, one goblin, a three-by-three room — so it stays cheap to read and cannot drift
 * into a second rules fixture.
 */
export const JSON_PACK_ID = "cardguild.test.json-pack";

export function createJsonPackFiles(): ContentPackFiles {
  return structuredClone({
    manifest,
    traits,
    conditions,
    actions,
    cards,
    equipment,
    actors,
    scenarios,
    adventures,
  }) as ContentPackFiles;
}

/** The same files as the compiler's single input, exactly as the content CLI assembles them. */
export function createJsonPackSource(): unknown {
  return assembleContentPackSource(createJsonPackFiles());
}
