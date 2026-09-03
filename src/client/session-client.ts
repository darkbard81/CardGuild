import { PRODUCTION_CONTENT } from "../content/production-content";
import type {
  ClientHello,
  ClientIntentEnvelope,
  ProtocolErrorCode,
  ServerError,
  ServerMessage,
  ServerSnapshot,
} from "../protocol";
import type { SessionIntent } from "../session";

const STORAGE_KEY = "cardguild.session.v2";
const TERMINAL_HANDSHAKE_FAILURES = new Set<ProtocolErrorCode>([
  "SESSION_NOT_FOUND",
  "UNAUTHENTICATED",
  "CONTENT_MISMATCH",
  "PROTOCOL_MISMATCH",
]);

export function isTerminalHandshakeFailure(code: ProtocolErrorCode): boolean {
  return TERMINAL_HANDSHAKE_FAILURES.has(code);
}

export interface SessionCredential {
  readonly sessionId: string;
  readonly playerId: string;
  readonly reconnectToken: string;
  readonly seat: 1 | 2 | 3;
}

export interface SessionClientHandlers {
  readonly onSnapshot: (snapshot: ServerSnapshot) => void;
  readonly onError: (error: ServerError) => void;
  readonly onStatus: (status: "connecting" | "connected" | "reconnecting" | "closed") => void;
}

interface ApiErrorBody {
  readonly code?: string;
  readonly message?: string;
}

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json() as T & ApiErrorBody;
  if (!response.ok) throw new Error(payload.message ?? payload.code ?? `Request failed with ${response.status}.`);
  return payload;
}

function websocketUrl(): string {
  const url = new URL("/ws", window.location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.href;
}

export class SessionClient {
  private socket: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private reconnectAttempt = 0;
  private destroyed = false;
  private terminallyClosed = false;
  private authenticatedSocket: WebSocket | null = null;
  private snapshotValue: ServerSnapshot | null = null;
  private outstanding: { readonly envelope: ClientIntentEnvelope; committedRevision?: number } | null = null;

  public constructor(
    public readonly credential: SessionCredential,
    private readonly handlers: SessionClientHandlers,
  ) {}

  public static async create(displayName: string): Promise<SessionCredential> {
    const credential = await apiPost<SessionCredential>("/api/sessions", { displayName });
    SessionClient.storeCredential(credential);
    return credential;
  }

  public static async join(sessionId: string, displayName: string): Promise<SessionCredential> {
    const credential = await apiPost<SessionCredential>(
      `/api/sessions/${encodeURIComponent(sessionId.trim())}/join`,
      { displayName },
    );
    SessionClient.storeCredential(credential);
    return credential;
  }

  public static loadCredential(): SessionCredential | null {
    try {
      const value = sessionStorage.getItem(STORAGE_KEY);
      if (!value) return null;
      const parsed = JSON.parse(value) as Partial<SessionCredential>;
      return typeof parsed.sessionId === "string" &&
        typeof parsed.playerId === "string" &&
        typeof parsed.reconnectToken === "string" &&
        (parsed.seat === 1 || parsed.seat === 2 || parsed.seat === 3)
        ? parsed as SessionCredential
        : null;
    } catch {
      return null;
    }
  }

  public static clearCredential(): void {
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // Storage may be unavailable in privacy-restricted contexts.
    }
  }

  private static storeCredential(credential: SessionCredential): void {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(credential));
    } catch {
      // The live in-memory credential still works for the current page.
    }
  }

  public get snapshot(): ServerSnapshot | null {
    return this.snapshotValue;
  }

  public connect(): void {
    if (
      this.destroyed ||
      this.terminallyClosed ||
      this.socket?.readyState === WebSocket.OPEN ||
      this.socket?.readyState === WebSocket.CONNECTING
    ) return;
    this.handlers.onStatus(this.reconnectAttempt > 0 ? "reconnecting" : "connecting");
    const socket = new WebSocket(websocketUrl());
    this.socket = socket;
    socket.addEventListener("open", () => {
      if (this.socket !== socket) return;
      const hello: ClientHello = {
        v: 3,
        type: "hello",
        sessionId: this.credential.sessionId,
        playerId: this.credential.playerId,
        reconnectToken: this.credential.reconnectToken,
        contentIdentity: PRODUCTION_CONTENT.contentIdentity,
      };
      socket.send(JSON.stringify(hello));
      if (this.outstanding) socket.send(JSON.stringify(this.outstanding.envelope));
    });
    socket.addEventListener("message", (event) => {
      if (this.socket !== socket) return;
      this.receive(socket, JSON.parse(String(event.data)) as ServerMessage);
    });
    socket.addEventListener("close", (event) => {
      if (this.socket === socket) this.socket = null;
      if (this.authenticatedSocket === socket) this.authenticatedSocket = null;
      if (this.destroyed || this.terminallyClosed) return;
      if (event.code === 4001) {
        this.stopTerminal({
          v: 3,
          type: "error",
          code: "UNAUTHENTICATED",
          message: "This session was opened in a newer connection.",
        }, false);
        return;
      }
      if (event.code === 4003 || event.code === 4004) {
        this.stopTerminal({
          v: 3,
          type: "error",
          code: event.code === 4004 ? "SESSION_NOT_FOUND" : "UNAUTHENTICATED",
          message: event.reason || "The session handshake was rejected.",
        }, true);
        return;
      }
      this.scheduleReconnect();
    });
    socket.addEventListener("error", () => {
      // close drives reconnect and user-visible status.
    });
  }

  public sendIntent(intent: SessionIntent): boolean {
    const socket = this.socket;
    const snapshot = this.snapshotValue;
    if (!socket || socket.readyState !== WebSocket.OPEN || !snapshot || this.outstanding) return false;
    const envelope: ClientIntentEnvelope = {
      v: 3,
      type: "intent",
      requestId: crypto.randomUUID(),
      expectedRevision: snapshot.revision,
      intent,
    };
    this.outstanding = { envelope };
    socket.send(JSON.stringify(envelope));
    return true;
  }

  private receive(socket: WebSocket, message: ServerMessage): void {
    if (message.type === "error") {
      if (!message.requestId || this.outstanding?.envelope.requestId === message.requestId) this.outstanding = null;
      if (isTerminalHandshakeFailure(message.code)) {
        this.stopTerminal(message, true);
        if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
          socket.close(1000, "terminal handshake failure");
        }
        return;
      }
      this.handlers.onError(message);
      return;
    }
    if (message.type === "ack") {
      if (this.outstanding?.envelope.requestId !== message.requestId) return;
      if (!message.accepted) {
        this.outstanding = null;
      } else {
        this.outstanding = { ...this.outstanding, committedRevision: message.committedRevision };
        if ((this.snapshotValue?.revision ?? -1) >= message.committedRevision) this.outstanding = null;
      }
      return;
    }
    const shouldApply = !this.snapshotValue ||
      message.revision > this.snapshotValue.revision ||
      (
        message.revision === this.snapshotValue.revision &&
        message.controlRevision > this.snapshotValue.controlRevision
      ) ||
      message.cause?.kind === "resync";
    if (!shouldApply) return;
    if (this.authenticatedSocket !== socket) {
      this.authenticatedSocket = socket;
      this.reconnectAttempt = 0;
      this.handlers.onStatus("connected");
    }
    this.snapshotValue = message;
    if (
      this.outstanding?.committedRevision !== undefined &&
      message.revision >= this.outstanding.committedRevision
    ) this.outstanding = null;
    this.handlers.onSnapshot(message);
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null || this.destroyed || this.terminallyClosed) return;
    this.handlers.onStatus("reconnecting");
    const delay = Math.min(2_000, 250 * 2 ** Math.min(this.reconnectAttempt, 3));
    this.reconnectAttempt += 1;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private stopTerminal(error: ServerError, clearCredential: boolean): void {
    if (this.terminallyClosed) return;
    this.terminallyClosed = true;
    this.outstanding = null;
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (clearCredential) SessionClient.clearCredential();
    this.handlers.onStatus("closed");
    this.handlers.onError(error);
  }

  public destroy(): void {
    this.destroyed = true;
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer);
    this.socket?.close(1000, "client shutdown");
    this.socket = null;
    this.handlers.onStatus("closed");
  }
}
