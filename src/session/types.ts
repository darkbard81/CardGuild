import type { AdventureEvent, AdventureState } from "../adventure";
import type { CompiledContentPack } from "../content";
import type {
  ActionSource,
  ActionTarget,
  CardInstanceId,
  CombatEvent,
  CombatState,
  ContentIdentity,
} from "../game";
import type { PartyMemberLoadout } from "../loadout";

export type SessionSeatNumber = 1 | 2 | 3;

/** A connection/player ordering slot. It deliberately has no gameplay actor identity. */
export interface SessionSeat {
  readonly seat: SessionSeatNumber;
  readonly playerId: string;
  readonly displayName: string;
}

/** Ordered, deterministic gameplay party configuration prepared by the host. */
export interface SessionPartySlot {
  readonly slot: SessionSeatNumber;
  readonly memberId: string;
  readonly actorDefinitionId: string;
}

export interface SessionGuestClaims {
  readonly byMemberId: Readonly<Record<string, string>>;
}

export interface SessionCoreState {
  readonly version: 2;
  readonly sessionId: string;
  readonly revision: number;
  readonly contentIdentity: ContentIdentity;
  readonly lifecycle: "lobby" | "active";
  readonly hostPlayerId: string;
  readonly adventureSeed: number;
  readonly seats: readonly SessionSeat[];
  readonly partyPrepared: boolean;
  readonly partySlots: readonly SessionPartySlot[];
  readonly guestClaims: SessionGuestClaims;
  readonly adventure: AdventureState | null;
  readonly combat: CombatState | null;
}

export interface SessionAuthorityContext {
  readonly pack: CompiledContentPack;
  readonly adventureId: string;
}

/** Ephemeral presence-derived authority supplied by SessionHost at dispatch time. */
export interface SessionControlContext {
  readonly effectiveControllerByMemberId: Readonly<Record<string, string>>;
}

export interface SessionPlayerIdentity {
  readonly playerId: string;
  readonly displayName: string;
}

export interface CreateSessionOptions extends SessionPlayerIdentity {
  readonly sessionId: string;
  readonly adventureSeed: number;
}

export type SessionIntent =
  | { readonly type: "set-party-composition"; readonly actorDefinitionIds: readonly string[] }
  | { readonly type: "select-character"; readonly memberId: string }
  | { readonly type: "begin-adventure" }
  | { readonly type: "start-encounter" }
  | { readonly type: "choose-reward"; readonly rewardId: string; readonly choiceIndex: number }
  | { readonly type: "set-loadout"; readonly memberId: string; readonly loadout: PartyMemberLoadout }
  | { readonly type: "use-action"; readonly action: ActionSource; readonly target: ActionTarget }
  | { readonly type: "end-turn" }
  | { readonly type: "use-reaction"; readonly triggerId: string; readonly cardInstanceId: CardInstanceId }
  | { readonly type: "pass-reaction"; readonly triggerId: string };

/** Source-compatible name retained for code that treats every accepted intent as a core revision. */
export type SessionGameplayIntent = SessionIntent;

export type SessionErrorCode =
  | "ROSTER_LOCKED"
  | "SESSION_FULL"
  | "PARTY_NOT_PREPARED"
  | "CHARACTER_TAKEN"
  | "FORBIDDEN"
  | "DOMAIN_REJECTED";

export type SessionEvent =
  | AdventureEvent
  | CombatEvent
  | { readonly type: "SEAT_JOINED"; readonly seat: SessionSeatNumber }
  | { readonly type: "PARTY_COMPOSITION_SET"; readonly memberIds: readonly string[] }
  | { readonly type: "CHARACTER_SELECTED"; readonly playerId: string; readonly memberId: string };

export interface SessionTransitionResult {
  readonly accepted: boolean;
  readonly state: SessionCoreState;
  readonly events: readonly SessionEvent[];
  readonly errorCode?: SessionErrorCode;
  readonly error?: string;
}
