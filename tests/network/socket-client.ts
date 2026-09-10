import { WebSocket } from "ws";

import { PRODUCTION_CONTENT } from "../../src/content";
import type { ClientIntentEnvelope, ServerAck, ServerMessage, ServerSnapshot } from "../../src/protocol";
import type { SessionCredentialResponse } from "../../src/server/session-store";
import type { SessionIntent } from "../../src/session";

export const TEST_ORIGIN = "http://cardguild.test";

export function envelope(requestId: string, expectedRevision: number, intent: SessionIntent): ClientIntentEnvelope {
  return { v: 7, type: "intent", requestId, expectedRevision, intent };
}

/**
 * One real WebSocket player, shared by every M9-3/M9-5 durability suite.
 *
 * These tests all need the same three things — connect and say hello, wait for a specific
 * server message, and drive an intent to its ACK — and three private copies of that is how
 * one suite quietly stops checking what the others check.
 */
export class SocketClient {
  public readonly messages: ServerMessage[] = [];

  private constructor(public readonly socket: WebSocket) {
    socket.on("message", (data) => this.messages.push(JSON.parse(data.toString()) as ServerMessage));
    // A test that kills its server sees the transport error before the close; it is the
    // recovery that is under test, not the socket's dying breath.
    socket.on("error", () => undefined);
  }

  public static async connect(origin: string, credential: SessionCredentialResponse): Promise<SocketClient> {
    const socket = new WebSocket(origin.replace(/^http/, "ws") + "/ws", { origin: TEST_ORIGIN });
    const client = new SocketClient(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once("open", () => resolve());
      socket.once("error", reject);
    });
    socket.send(JSON.stringify({
      v: 7,
      type: "hello",
      sessionId: credential.sessionId,
      playerId: credential.playerId,
      reconnectToken: credential.reconnectToken,
      contentIdentity: PRODUCTION_CONTENT.contentIdentity,
    }));
    return client;
  }

  public mark(): number {
    return this.messages.length;
  }

  public waitFor<T extends ServerMessage>(
    predicate: (message: ServerMessage) => message is T,
    from = 0,
    timeoutMs = 15_000,
  ): Promise<T> {
    const existing = this.messages.slice(from).find(predicate);
    if (existing) return Promise.resolve(existing);
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.socket.off("message", listener);
        reject(new Error("Timed out after index " + String(from) + ": " + JSON.stringify(this.messages.slice(from))));
      }, timeoutMs);
      const listener = (): void => {
        const found = this.messages.slice(from).find(predicate);
        if (!found) return;
        clearTimeout(timeout);
        this.socket.off("message", listener);
        resolve(found);
      };
      this.socket.on("message", listener);
    });
  }

  public snapshot(from = 0): Promise<ServerSnapshot> {
    return this.waitFor((message): message is ServerSnapshot => message.type === "snapshot", from);
  }

  public ack(requestId: string, from = 0, timeoutMs?: number): Promise<ServerAck> {
    return this.waitFor(
      (message): message is ServerAck => message.type === "ack" && message.requestId === requestId, from, timeoutMs);
  }

  public waitForClose(timeoutMs = 15_000): Promise<number> {
    if (this.socket.readyState === WebSocket.CLOSED) return Promise.resolve(1000);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Socket never closed.")), timeoutMs);
      this.socket.once("close", (code) => {
        clearTimeout(timeout);
        resolve(code);
      });
    });
  }

  public send(message: ClientIntentEnvelope): void {
    this.socket.send(JSON.stringify(message));
  }

  public close(): Promise<void> {
    if (this.socket.readyState === WebSocket.CLOSED) return Promise.resolve();
    return new Promise((resolve) => {
      this.socket.once("close", () => resolve());
      this.socket.close(1000, "test close");
    });
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
