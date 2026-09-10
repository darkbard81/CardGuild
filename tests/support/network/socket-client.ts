import { WebSocket } from "ws";

import { PRODUCTION_CONTENT } from "../../../src/content";
import type { ContentIdentity } from "../../../src/game";
import type { ClientIntentEnvelope, ServerAck, ServerMessage, ServerSnapshot } from "../../../src/protocol";
import type { SessionCredentialResponse } from "../../../src/server/session-store";
import type { SessionIntent } from "../../../src/session";

export const TEST_ORIGIN = "http://cardguild.test";

export function envelope(requestId: string, expectedRevision: number, intent: SessionIntent): ClientIntentEnvelope {
  return { v: 7, type: "intent", requestId, expectedRevision, intent };
}

/** How a connection actually ended, as reported by the socket's own close event. */
export interface SocketClosure {
  readonly code: number;
  readonly reason: string;
}

/**
 * A wait that ended because the connection did.
 *
 * This is the difference between "the answer has not arrived yet" and "the answer can never
 * arrive". A killed server produces the second, and a caller that cannot tell them apart has
 * to sit out the whole timeout before it can even ask which one happened.
 */
export class SocketClosedError extends Error {
  public constructor(
    public readonly code: number,
    public readonly reason: string,
    /** Where the interrupted wait started reading, so the caller can see what it did get. */
    public readonly from: number,
    /** The transport failure that preceded the close, when there was one. */
    public readonly transportError?: Error,
  ) {
    super(
      `The connection closed with ${String(code)}` +
      (reason ? ` (${reason})` : "") +
      ` while waiting from index ${String(from)}.` +
      (transportError ? ` Transport error: ${transportError.message}` : ""),
    );
    this.name = "SocketClosedError";
  }
}

export interface ConnectOptions {
  /** What the hello claims to be built against, so a mismatched peer can be refused. */
  readonly contentIdentity?: ContentIdentity;
  /** The hello envelope's protocol version, so a legacy peer can be refused on purpose. */
  readonly protocolVersion?: number;
  /** The `Origin` header, which the gateway checks before it will upgrade. */
  readonly origin?: string;
}

/**
 * One real WebSocket player, shared by every suite that speaks the protocol.
 *
 * Four copies of this used to exist, and they had already drifted: one waited five seconds
 * for a message and another fifteen, one swallowed transport errors and another did not,
 * and only one could say hello as an older client. A suite that quietly checks something
 * weaker than its neighbours is the failure this consolidation is meant to prevent, so the
 * union of what they could each express lives here.
 */
export class SocketClient {
  public readonly messages: ServerMessage[] = [];

  private closure: SocketClosure | null = null;
  private lastTransportError: Error | null = null;

  private constructor(public readonly socket: WebSocket) {
    socket.on("message", (data) => this.messages.push(JSON.parse(data.toString()) as ServerMessage));
    // Registered before anything can wait, so every waiter's own close listener already sees
    // the recorded code by the time it runs.
    socket.on("close", (code: number, reason: Buffer) => {
      this.closure ??= { code, reason: reason.toString() };
    });
    // A test that kills its server sees the transport error before the close; it is the
    // recovery that is under test, not the socket's dying breath. It is kept rather than
    // dropped because it is the only thing that says *why*, but it never decides anything:
    // a connection is dead when it has closed, not when it has complained.
    socket.on("error", (error: Error) => { this.lastTransportError = error; });
  }

  public static async connect(
    origin: string,
    credential: SessionCredentialResponse,
    options: ConnectOptions = {},
  ): Promise<SocketClient> {
    const socket = new WebSocket(origin.replace(/^http/, "ws") + "/ws", {
      origin: options.origin ?? TEST_ORIGIN,
    });
    const client = new SocketClient(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once("open", () => resolve());
      socket.once("error", reject);
    });
    socket.send(JSON.stringify({
      v: options.protocolVersion ?? 7,
      type: "hello",
      sessionId: credential.sessionId,
      playerId: credential.playerId,
      reconnectToken: credential.reconnectToken,
      contentIdentity: options.contentIdentity ?? PRODUCTION_CONTENT.contentIdentity,
    }));
    return client;
  }

  /** Where the message log stands now, so a wait can ignore everything before this point. */
  public mark(): number {
    return this.messages.length;
  }

  /** The recorded end of this connection, or null while it is still open. */
  public get closedWith(): SocketClosure | null {
    return this.closure;
  }

  /**
   * The first message at or after `from` that satisfies `predicate`.
   *
   * Three things can end this wait and each has to mean something different. The message
   * arriving is success. The timeout expiring means the server is still there and still
   * silent, which is a real failure. The connection closing means no message will ever
   * arrive, so waiting the rest of the timeout out only delays the same answer — but a
   * message already in the log wins over the close, because it did arrive.
   */
  public waitFor<T extends ServerMessage>(
    predicate: (message: ServerMessage) => message is T,
    from = 0,
    timeoutMs = 15_000,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      // Armed first so `finish` can always clear it; it cannot fire until this function has
      // returned, by which point everything it reaches is initialised.
      const timer = setTimeout(() => finish(() => reject(new Error(
        "Timed out after index " + String(from) + ": " + JSON.stringify(this.messages.slice(from))))), timeoutMs);
      let done = false;
      // Only this wait's own listeners and timer are removed, so concurrent waits on the
      // same socket cannot cancel each other.
      const finish = (settle: () => void): void => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        this.socket.off("message", onMessage);
        this.socket.off("close", onClose);
        settle();
      };
      const scan = (): boolean => {
        let found: T | undefined;
        try {
          found = this.messages.slice(from).find(predicate);
        } catch (error) {
          finish(() => reject(error instanceof Error ? error : new Error(String(error))));
          return true;
        }
        if (found === undefined) return false;
        const hit = found;
        finish(() => resolve(hit));
        return true;
      };
      const onMessage = (): void => { scan(); };
      // Messages are delivered before the close, so anything that qualifies is already here.
      const onClose = (): void => {
        if (scan()) return;
        finish(() => reject(this.closedError(from)));
      };

      if (scan()) return;
      if (this.closure) {
        finish(() => reject(this.closedError(from)));
        return;
      }
      this.socket.on("message", onMessage);
      this.socket.on("close", onClose);
    });
  }

  public snapshot(
    from = 0,
    predicate: (snapshot: ServerSnapshot) => boolean = () => true,
  ): Promise<ServerSnapshot> {
    return this.waitFor(
      (message): message is ServerSnapshot => message.type === "snapshot" && predicate(message), from);
  }

  public ack(requestId: string, from = 0, timeoutMs?: number): Promise<ServerAck> {
    return this.waitFor(
      (message): message is ServerAck => message.type === "ack" && message.requestId === requestId, from, timeoutMs);
  }

  /** The code the *server* closed with, which is how a retired session announces itself. */
  public waitForClose(timeoutMs = 15_000): Promise<number> {
    if (this.closure) return Promise.resolve(this.closure.code);
    return new Promise((resolve, reject) => {
      const onClose = (code: number): void => {
        clearTimeout(timeout);
        resolve(code);
      };
      const timeout = setTimeout(() => {
        this.socket.off("close", onClose);
        reject(new Error("Socket never closed."));
      }, timeoutMs);
      this.socket.once("close", onClose);
    });
  }

  public send(message: ClientIntentEnvelope): void {
    this.socket.send(JSON.stringify(message));
  }

  /** Close from this side and report the code the connection actually ended with. */
  public close(): Promise<number> {
    if (this.closure) return Promise.resolve(this.closure.code);
    const closed = this.waitForClose();
    if (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING) {
      this.socket.close(1000, "test close");
    }
    return closed;
  }

  private closedError(from: number): SocketClosedError {
    const closure = this.closure ?? { code: 1006, reason: "" };
    return new SocketClosedError(closure.code, closure.reason, from, this.lastTransportError ?? undefined);
  }
}

/** Send one intent and wait for both the ACK and the snapshot a commit must publish. */
export async function play(
  client: SocketClient,
  snapshot: ServerSnapshot,
  requestId: string,
  intent: SessionIntent,
): Promise<ServerSnapshot> {
  const mark = client.mark();
  client.send(envelope(requestId, snapshot.revision, intent));
  const ack = await client.ack(requestId, mark);
  if (!ack.accepted) {
    throw new Error(`Intent "${requestId}" (${intent.type}) was refused: ` +
      JSON.stringify(client.messages.slice(mark)));
  }
  return await client.waitFor(
    (message): message is ServerSnapshot => message.type === "snapshot" && message.revision >= ack.committedRevision,
    mark);
}
