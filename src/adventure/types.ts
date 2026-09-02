import type { ActorDefinition, AdventureDefinition, RewardGrant } from "../content/content-types";
import type { ActorDefinitionId, CombatContent, ScenarioId } from "../game/types";
import type { LoadoutCollection, LoadoutParty, LoadoutPartyMember, PartyMemberLoadout } from "../loadout";

export type AdventurePhase =
  | "ready"
  | "combat"
  | "reward"
  | "between-encounters"
  | "complete"
  | "failed";

export interface PartyMemberState extends LoadoutPartyMember {
  readonly id: string;
  readonly seat: 1 | 2 | 3;
  readonly actorDefinitionId: ActorDefinitionId;
  readonly loadout: PartyMemberLoadout;
}

export interface PartyState extends LoadoutParty {
  readonly members: Readonly<Record<string, PartyMemberState>>;
}

export interface CollectionState extends LoadoutCollection {
  readonly equipment: Readonly<Record<string, number>>;
  readonly cards: Readonly<Record<string, number>>;
}

export interface AdventureRuntimeContext {
  readonly definition: AdventureDefinition;
  readonly actorDefinitions: Readonly<Record<ActorDefinitionId, ActorDefinition>>;
  readonly combatContent: CombatContent;
}

export interface RewardOffer {
  readonly rewardId: string;
  readonly encounterId: ScenarioId;
  readonly choices: readonly RewardGrant[];
}

export interface AdventureState {
  readonly version: 2;
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
  | { readonly type: "choose-reward"; readonly rewardId: string; readonly choiceIndex: number }
  | {
      readonly type: "set-member-loadout";
      readonly memberId: string;
      readonly loadout: PartyMemberLoadout;
    };

export type AdventureEvent =
  | { readonly type: "ADVENTURE_STARTED"; readonly adventureId: string }
  | { readonly type: "ENCOUNTER_STARTED"; readonly encounterId: ScenarioId; readonly combatSeed: number }
  | { readonly type: "ENCOUNTER_COMPLETED"; readonly encounterId: ScenarioId }
  | { readonly type: "REWARD_OFFERED"; readonly offer: RewardOffer }
  | { readonly type: "REWARD_GRANTED"; readonly rewardId: string; readonly grant: RewardGrant }
  | {
      readonly type: "LOADOUT_CHANGED";
      readonly memberId: string;
      readonly previous: PartyMemberLoadout;
      readonly next: PartyMemberLoadout;
    }
  | { readonly type: "ADVENTURE_COMPLETED"; readonly adventureId: string }
  | { readonly type: "ADVENTURE_FAILED"; readonly encounterId: ScenarioId };

export interface AdventureDispatchResult {
  readonly accepted: boolean;
  readonly state: AdventureState;
  readonly events: readonly AdventureEvent[];
  readonly error?: string;
}
