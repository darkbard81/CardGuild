import type { TraitCategory, TraitSource } from "./types";

/**
 * The closed vocabularies behind `TraitDefinition.source` and `.category`, in one place so
 * the JSON Schema, the semantic validator and any UI selector agree on the same list.
 */
export const TRAIT_SOURCES = ["pf2e-remaster", "cardguild"] as const satisfies readonly TraitSource[];

export const TRAIT_CATEGORIES = [
  "system",
  "ancestry",
  "class",
  "personality",
  "creature",
  "action",
  "weapon",
  "equipment",
  "condition",
  "terrain",
  "damage",
  "general",
] as const satisfies readonly TraitCategory[];

export function isTraitSource(value: unknown): value is TraitSource {
  return (TRAIT_SOURCES as readonly unknown[]).includes(value);
}

export function isTraitCategory(value: unknown): value is TraitCategory {
  return (TRAIT_CATEGORIES as readonly unknown[]).includes(value);
}
