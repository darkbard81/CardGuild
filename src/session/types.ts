import type { AdventureEvent, AdventureState } from "../adventure";
import type { CompiledContentPack } from "../content";
import type {
  ActionSource,
  ActionTarget,
  CardInstanceId,
  CombatEvent,
  CombatState,
  ContentIdentity,
  Direction,
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

/**
 * The gameplay-only projection of a session. This is exactly what a durable Campaign save
 * holds and exactly what the canonical gameplay hash covers, so the server can restore a
 * session without the pure layer ever learning about accounts, sockets, or SQL.
 */
export interface SessionGameplayProjection {
  readonly contentIdentity: ContentIdentity;
  readonly partySlots: readonly SessionPartySlot[];
  readonly adventure: AdventureState;
  readonly combat: CombatState | null;
}

/** What `hashSessionGameplayState()` reads. A lobby has no Adventure yet, so it is nullable here. */
export interface SessionGameplayHashInput {
  readonly contentIdentity: ContentIdentity;
  readonly partySlots: readonly SessionPartySlot[];
  readonly adventure: AdventureState | null;
  readonly combat: CombatState | null;
}

/**
 * `resume-lobby` is a restored Campaign waiting for its Host to press Resume. It already
 * holds saved Adventure and Combat state, which is why it is a distinct lifecycle rather
 * than an `active` session: every gameplay intent stays forbidden until Resume.
 */
export type SessionLifecycle = "lobby" | "resume-lobby" | "active";

export interface SessionCoreState {
  readonly version: 3;
  readonly sessionId: string;
  readonly revision: number;
  readonly contentIdentity: ContentIdentity;
  readonly lifecycle: SessionLifecycle;
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
  readonly connectedPlayerIds: readonly string[];
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

/** A restored session keeps none of the old live identity: only the saved gameplay. */
export interface ResumeSessionOptions extends SessionPlayerIdentity {
  readonly sessionId: string;
}

export type SessionIntent =
  | { readonly type: "set-party-composition"; readonly actorDefinitionIds: readonly string[] }
  | { readonly type: "select-character"; readonly memberId: string }
  | { readonly type: "remove-offline-guest"; readonly playerId: string }
  | { readonly type: "begin-adventure" }
  | { readonly type: "resume-adventure" }
  | { readonly type: "start-encounter" }
  | { readonly type: "choose-reward"; readonly rewardId: string; readonly choiceIndex: number }
  | { readonly type: "set-loadout"; readonly memberId: string; readonly loadout: PartyMemberLoadout }
  | { readonly type: "use-action"; readonly action: ActionSource; readonly target: ActionTarget }
  | { readonly type: "end-turn"; readonly facing: Direction }
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
  | { readonly type: "SEAT_REMOVED"; readonly seat: SessionSeatNumber; readonly playerId: string }
  | { readonly type: "PARTY_COMPOSITION_SET"; readonly memberIds: readonly string[] }
  | { readonly type: "CHARACTER_SELECTED"; readonly playerId: string; readonly memberId: string };

export interface SessionTransitionResult {
  readonly accepted: boolean;
  readonly state: SessionCoreState;
  readonly events: readonly SessionEvent[];
  readonly errorCode?: SessionErrorCode;
  readonly error?: string;
}
