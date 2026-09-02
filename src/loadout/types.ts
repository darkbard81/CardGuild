import type { ActorDefinition, CompiledContentPack } from "../content/content-types";
import type {
  ActorDefinitionId,
  ArmorCategory,
  CardDefinitionId,
  DeckContribution,
  EquipmentId,
  EquipmentSlotId,
  ResolvedStrikeProfile,
} from "../game/types";

export const EQUIPMENT_SLOT_ORDER = ["weapon", "armor", "shield", "feet"] as const satisfies readonly EquipmentSlotId[];

export interface PartyMemberLoadout {
  readonly equipment: Readonly<Partial<Record<EquipmentSlotId, EquipmentId>>>;
  readonly preparedCards: readonly CardDefinitionId[];
}

export interface LoadoutPartyMember {
  readonly id: string;
  readonly actorDefinitionId: ActorDefinitionId;
  readonly loadout: PartyMemberLoadout;
}

export interface LoadoutParty {
  readonly members: Readonly<Record<string, LoadoutPartyMember>>;
}

export interface LoadoutCollection {
  readonly equipment: Readonly<Record<string, number>>;
  readonly cards: Readonly<Record<string, number>>;
}

export interface LoadoutContent {
  readonly actorDefinitions: CompiledContentPack["actorDefinitions"];
  readonly combatContent: CompiledContentPack["combatContent"];
}

export type LoadoutValidationCode =
  | "UNKNOWN_ACTOR"
  | "UNKNOWN_EQUIPMENT"
  | "UNKNOWN_CARD"
  | "SLOT_MISMATCH"
  | "EQUIPMENT_COPIES_EXCEEDED"
  | "CARD_COPIES_EXCEEDED"
  | "PREPARED_CAPACITY_EXCEEDED";

export interface LoadoutValidationIssue {
  readonly code: LoadoutValidationCode;
  readonly message: string;
  readonly memberId?: string;
  readonly definitionId?: string;
  readonly slot?: EquipmentSlotId;
}

export interface LoadoutValidationResult {
  readonly valid: boolean;
  readonly issues: readonly LoadoutValidationIssue[];
}

export interface DerivedDeck {
  readonly contributions: readonly DeckContribution[];
  readonly totalCards: number;
}

export interface DerivedLoadoutSnapshot {
  readonly equipmentIds: readonly EquipmentId[];
  readonly deck: DerivedDeck;
  readonly statistics: {
    readonly maxHp: number;
    readonly ac: number;
    readonly classDc: number;
    readonly reflex: {
      readonly modifier: number;
      readonly dc: number;
    };
    readonly athletics: number;
    readonly initiative: number;
  };
  /** The same resolved Strike combat rolls against, never a raw weapon profile. */
  readonly strike: ResolvedStrikeProfile;
  readonly armor: DerivedArmorSummary;
  readonly contextActionIds: readonly string[];
}

/** Equipped armor as the AC resolver sees it; `unarmored` when no armor is worn. */
export interface DerivedArmorSummary {
  readonly id: EquipmentId | null;
  readonly name: string;
  readonly category: ArmorCategory;
  readonly acItemBonus: number;
  readonly dexCap: number | null;
}

export interface LoadoutPreview {
  readonly legal: boolean;
  readonly validation: LoadoutValidationResult;
  readonly before: DerivedLoadoutSnapshot;
  readonly after: DerivedLoadoutSnapshot | null;
  readonly addedCards: readonly DeckContribution[];
  readonly removedCards: readonly DeckContribution[];
  readonly addedContextActionIds: readonly string[];
  readonly removedContextActionIds: readonly string[];
}

export type ActorDefinitionMap = Readonly<Record<ActorDefinitionId, ActorDefinition>>;
