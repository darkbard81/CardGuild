import { createAdventureSession } from "../adventure/runtime";
import { buildAdventureEncounter } from "../adventure/combat-bridge";
import type { PartySetup } from "../adventure/types";
import { isAuthoredPlayable } from "../character/member";
import type { CompiledContentPack, PartySizeNumber } from "../content/content-types";

/** Level-one composition preview, independent of saved campaign progress/recruitment. */
export function previewCampaignEncounter(pack: CompiledContentPack, adventureId: string, scenarioId: string, partySize: PartySizeNumber) {
  const adventure = pack.adventures[adventureId];
  if (!adventure) throw new Error("미리볼 캠페인이 없습니다.");
  const starters = Object.values(pack.actorDefinitions).filter(a => isAuthoredPlayable(a, pack));
  if (starters.length < partySize) throw new Error("미리보기에 필요한 Lv1 캐릭터가 부족합니다.");
  const party: PartySetup = { members: Object.fromEntries(starters.slice(0, partySize).map((actor, i) => {
    const id = `preview.hero-${i + 1}`;
    return [id, { id, seat: (i + 1) as PartySizeNumber, actorDefinitionId: actor.id, loadout: actor.starterLoadout }];
  })) };
  const session = createAdventureSession({ ...pack, definition: { ...adventure,
    partySize: { min: 1, max: 3 }, rewards: [],
  } }, party, 60);
  return buildAdventureEncounter(pack, { ...session, phase: "combat", currentEncounterId: scenarioId });
}
