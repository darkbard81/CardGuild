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

export interface SessionSeat {
  readonly seat: SessionSeatNumber;
  readonly playerId: string;
  readonly memberId: string;
  readonly actorDefinitionId: string;
  readonly displayName: string;
}
export interface SessionCoreState {
  readonly version: 1;
  readonly sessionId: string;
  readonly revision: number;
  readonly contentIdentity: ContentIdentity;
  readonly lifecycle: "lobby" | "active";
  readonly hostPlayerId: string;
  readonly adventureSeed: number;
  readonly seats: readonly SessionSeat[];
  readonly adventure: AdventureState | null;
  readonly combat: CombatState | null;
}

export interface SessionAuthorityContext {
  readonly pack: CompiledContentPack;
  readonly adventureId: string;
  readonly actorDefinitionId: string;
}

export interface SessionPlayerIdentity {
  readonly playerId: string;
  readonly displayName: string;
}

export interface CreateSessionOptions extends SessionPlayerIdentity {
  readonly sessionId: string;
  readonly adventureSeed: number;
}

export type SessionGameplayIntent =
  | { readonly type: "begin-adventure" }
  | { readonly type: "start-encounter" }
  | { readonly type: "choose-reward"; readonly rewardId: string; readonly choiceIndex: number }
  | { readonly type: "set-loadout"; readonly loadout: PartyMemberLoadout }
  | { readonly type: "use-action"; readonly action: ActionSource; readonly target: ActionTarget }
  | { readonly type: "end-turn" }
  | { readonly type: "use-reaction"; readonly triggerId: string; readonly cardInstanceId: CardInstanceId }
  | { readonly type: "pass-reaction"; readonly triggerId: string };

export type SessionErrorCode =
  | "ROSTER_LOCKED"
  | "SESSION_FULL"
  | "FORBIDDEN"
  | "DOMAIN_REJECTED";

export type SessionEvent =
  | AdventureEvent
  | CombatEvent
  | { readonly type: "SEAT_JOINED"; readonly seat: SessionSeatNumber; readonly memberId: string };

export interface SessionTransitionResult {
  readonly accepted: boolean;
  readonly state: SessionCoreState;
  readonly events: readonly SessionEvent[];
  readonly errorCode?: SessionErrorCode;
  readonly error?: string;
}
