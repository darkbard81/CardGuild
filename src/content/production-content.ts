import type { ContentIdentity } from "../game/types";
import type { AdventureDefinition, CompiledContentPack } from "./content-types";
import {
  M7_ADVENTURE,
  M7_ADVENTURE_ID,
  M7_COMPILED_PACK,
  M7_CONTENT_IDENTITY,
} from "./load-m7-content";

/**
 * The single compile-time point where the runtime picks its authoritative pack.
 *
 * Client UI, battle rendering and the authoritative server all read production
 * content from here so they cannot drift onto different packs. Milestone loaders
 * stay separate: `load-m6-content.ts` remains the rule regression fixture.
 *
 * Changing the production pack means changing the loader imported below and
 * nothing else. This is deliberately not a dynamic selector — no environment
 * switch, no runtime branching, no mod loading.
 *
 * Production code imports this module directly rather than through
 * `src/content/index.ts`. The barrel re-exports every milestone loader, and each
 * loader compiles its pack at module scope, so a barrel import would pull the M3
 * and M6 regression fixtures into the shipped client and server bundles. Tests
 * may keep using the barrel.
 */
export interface ProductionContent {
  readonly pack: CompiledContentPack;
  readonly adventureId: string;
  readonly adventure: AdventureDefinition;
  readonly contentIdentity: ContentIdentity;
}

export const PRODUCTION_CONTENT: ProductionContent = {
  pack: M7_COMPILED_PACK,
  adventureId: M7_ADVENTURE_ID,
  adventure: M7_ADVENTURE,
  contentIdentity: M7_CONTENT_IDENTITY,
} as const;
