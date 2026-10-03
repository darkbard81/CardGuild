import type { ContentPackSource } from "../content/content-types";
import type { CampaignScenery } from "../presentation/build-tilemaps";
import type { SceneDefinition } from "../scene/types";
import type { TerrainElevationDocument } from "../presentation/terrain-elevation";

export interface EncounterBriefing {
  readonly sceneId: string;
  readonly title: string;
  readonly finishLabel: string;
}
export interface CampaignDialogue {
  readonly scenes: Readonly<Record<string, SceneDefinition>>;
  readonly bindings: {
    readonly welcome: string;
    readonly firstBattle: string;
    readonly proneRecovery: string;
    readonly flankingTraining: string;
    readonly knowledgeTraining: string;
    readonly encounters: Readonly<Record<string, EncounterBriefing>>;
  };
}
/** The ID is also a terrain Trait ID. Rules stay in existing interaction primitives. */
export interface CampaignObjectTemplate {
  readonly id: string;
  readonly name: string;
  readonly visual: string;
  readonly interaction: "destroy-obstacle" | "open-gate";
}
export interface CampaignProject {
  readonly version: 1;
  /** Revision of repository inputs at export; edits keep this value until applied. */
  readonly baseRevision: string;
  readonly activeAdventureId: string;
  readonly content: ContentPackSource;
  readonly dialogue: CampaignDialogue;
  readonly presentation: {
    readonly elevations: TerrainElevationDocument;
    readonly backgrounds: Readonly<Record<string, string>>;
    readonly objects: readonly CampaignObjectTemplate[];
    readonly scenery: readonly CampaignScenery[];
  };
}
export interface CampaignIssue { readonly path: string; readonly message: string }
