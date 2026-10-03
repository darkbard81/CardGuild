import templates from "../../presentation/m3/campaign-objects.json";
import type { CampaignObjectTemplate } from "../authoring/types";
import type { MapObjectState } from "../game/types";

export const CAMPAIGN_OBJECTS = templates as readonly CampaignObjectTemplate[];
export function campaignObjectVisual(object: Pick<MapObjectState, "traits" | "interaction">,
  library: readonly CampaignObjectTemplate[] = CAMPAIGN_OBJECTS): string {
  const candidates = library.filter(template => object.traits.some(trait => trait.id === template.id));
  if (candidates.length !== 1 || candidates[0]!.interaction !== object.interaction.kind)
    throw new Error("오브젝트 동작에 맞는 이미지 템플릿이 필요합니다.");
  return candidates[0]!.visual;
}
