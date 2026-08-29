import type { RewardGrant } from "../content/content-types";
import type { ActorDefinitionId, EquipmentId, ScenarioId } from "../game/types";

export type AdventurePhase =
  | "ready"
  | "combat"
  | "reward"
  | "between-encounters"
  | "complete"
  | "failed";

export interface PartyMemberState {
  readonly id: string;
  readonly actorDefinitionId: ActorDefinitionId;
  readonly equipmentIds: readonly EquipmentId[];
}

export interface PartyState {
  readonly members: Readonly<Record<string, PartyMemberState>>;
}

export interface CollectionState {
  readonly equipment: Readonly<Record<string, number>>;
  readonly cards: Readonly<Record<string, number>>;
}

export interface RewardOffer {
  readonly rewardId: string;
  readonly encounterId: ScenarioId;
  readonly choices: readonly RewardGrant[];
}

export interface AdventureState {
  readonly version: 1;
  readonly adventureId: string;
  readonly phase: AdventurePhase;
  readonly currentEncounterId: ScenarioId | null;
  readonly completedEncounterIds: readonly ScenarioId[];
  readonly party: PartyState;
  readonly collection: CollectionState;
  readonly pendingReward: RewardOffer | null;
  readonly adventureSeed: number;
}

export interface EncounterResult {
  readonly encounterId: ScenarioId;
  readonly outcome: "victory" | "defeat";
  readonly combatSeed: number;
  readonly finalCombatHash: string;
}

export type AdventureCommand =
  | { readonly type: "start-adventure" }
  | { readonly type: "start-encounter" }
  | { readonly type: "continue-adventure" }
  | { readonly type: "accept-combat-result"; readonly result: EncounterResult }
  | { readonly type: "choose-reward"; readonly rewardId: string; readonly choiceIndex: number };

export type AdventureEvent =
  | { readonly type: "ADVENTURE_STARTED"; readonly adventureId: string }
  | { readonly type: "ENCOUNTER_STARTED"; readonly encounterId: ScenarioId; readonly combatSeed: number }
  | { readonly type: "ENCOUNTER_COMPLETED"; readonly encounterId: ScenarioId }
  | { readonly type: "REWARD_OFFERED"; readonly offer: RewardOffer }
  | { readonly type: "REWARD_GRANTED"; readonly rewardId: string; readonly grant: RewardGrant }
  | { readonly type: "ADVENTURE_COMPLETED"; readonly adventureId: string }
  | { readonly type: "ADVENTURE_FAILED"; readonly encounterId: ScenarioId };

export interface AdventureDispatchResult {
  readonly accepted: boolean;
  readonly state: AdventureState;
  readonly events: readonly AdventureEvent[];
  readonly error?: string;
}
