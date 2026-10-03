import { M7_CONTENT_SOURCE } from "../content/load-m7-content";
import generation from "../../art/source/generation-plan.json";
import campaign from "../../content/m7/campaign.json";
import dialogue from "../scene/campaign-dialogue.json";
import elevations from "../../presentation/m3/terrain-elevations.json";
import backgrounds from "../../presentation/m3/encounter-backgrounds.json";
import objects from "../../presentation/m3/campaign-objects.json";
import manifest from "../../presentation/m3/asset-manifest.json";
import { SCENE_CATALOG } from "../scene/face-catalog";
import { campaignRevision, type CampaignValidationContext } from "./project";
import type { CampaignProject } from "./types";

export const CAMPAIGN_VALIDATION_CONTEXT: CampaignValidationContext = { assets: manifest.assets, sceneCatalog: SCENE_CATALOG, objectVisuals: generation.presentation.objectVisuals };
export function createCampaignProject(): CampaignProject {
  const body = { version: 1, activeAdventureId: campaign.adventureId, authoredAdventureIds: campaign.authoredAdventureIds, content: M7_CONTENT_SOURCE,
    dialogue, presentation: { elevations, backgrounds, objects, scenery: generation.presentation.scenery } } as unknown as Omit<CampaignProject, "baseRevision">;
  return structuredClone({ ...body, baseRevision: campaignRevision(body) });
}
