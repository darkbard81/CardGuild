import type { ContentIdentity } from "../game";
import type { SessionCoreState, SessionEvent, SessionIntent } from "../session";

export const PROTOCOL_VERSION = 2 as const;
export const MAX_WS_PAYLOAD_BYTES = 64 * 1024;

export interface ClientHello {
  readonly v: 2;
  readonly type: "hello";
  readonly sessionId: string;
  readonly playerId: string;
  readonly reconnectToken: string;
  readonly contentIdentity: ContentIdentity;
}

export interface ClientIntentEnvelope {
  readonly v: 2;
  readonly type: "intent";
  readonly requestId: string;
  readonly expectedRevision: number;
  readonly intent: SessionIntent;
}

export type ClientMessage = ClientHello | ClientIntentEnvelope;

export type ProtocolErrorCode =
  | "INVALID_MESSAGE"
  | "PROTOCOL_MISMATCH"
  | "CONTENT_MISMATCH"
  | "UNAUTHENTICATED"
  | "SESSION_NOT_FOUND"
  | "ROSTER_LOCKED"
  | "SESSION_FULL"
  | "PARTY_NOT_PREPARED"
  | "CHARACTER_TAKEN"
  | "FORBIDDEN"
  | "STALE_REVISION"
  | "REQUEST_ID_REUSE"
  | "DOMAIN_REJECTED";

export interface ServerControlView {
  readonly connectedPlayerIds: readonly string[];
  readonly effectiveControllerByMemberId: Readonly<Record<string, string>>;
}

export interface ServerSnapshot {
  readonly v: 2;
  readonly type: "snapshot";
  readonly revision: number;
  readonly controlRevision: number;
  readonly gameplayHash: string;
  readonly state: SessionCoreState;
  readonly control: ServerControlView;
  readonly cause?: {
    readonly kind: "join" | "intent" | "server" | "control" | "resync";
    readonly requestId?: string;
  };
  readonly events: readonly SessionEvent[];
}

export interface ServerAck {
  readonly v: 2;
  readonly type: "ack";
  readonly requestId: string;
  readonly accepted: boolean;
  readonly committedRevision: number;
}

export interface ServerError {
  readonly v: 2;
  readonly type: "error";
  readonly code: ProtocolErrorCode;
  readonly message: string;
  readonly requestId?: string;
  readonly revision?: number;
}

export type ServerMessage = ServerSnapshot | ServerAck | ServerError;
