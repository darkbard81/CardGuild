import type { AdventurePhase } from "../adventure/types";

export interface CampaignProgressSummary {
  readonly phase: AdventurePhase;
  readonly completedEncounters: number;
  readonly totalEncounters: number;
  readonly encounterId: string | null;
  readonly encounterName: string | null;
  readonly party: readonly { readonly memberId: string; readonly actorDefinitionId: string; readonly name: string; readonly level: number }[];
}
export interface CampaignSummary {
  readonly campaignId: string;
  readonly name: string;
  readonly hasSave: boolean;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly saveStatus: "empty" | "ready" | "SAVE_CORRUPT" | "SAVE_SCHEMA_UNSUPPORTED" | "SAVE_CONTENT_MISMATCH";
  readonly savedAt: number | null;
  readonly progress: CampaignProgressSummary | null;
}
