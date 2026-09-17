import { once } from "node:events";
import { WebSocket } from "ws";
import { PROTOCOL_VERSION, type ClientHello, type ServerMessage, type ServerSnapshot } from "../../src/protocol";
import type { SessionIntent } from "../../src/session";
import type { SessionCredentialResponse } from "../../src/server/session-store";
import { PRODUCTION_CONTENT } from "../../src/content/production-content";

export const TEST_ORIGIN = "http://contract.test";
export const PASSWORD = "contract-test-password";

export async function api(origin: string, route: string, body?: unknown, cookie = "") {
  return fetch(`${origin}${route}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", cookie },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

export async function register(origin: string, username: string) {
  const response = await api(origin, "/api/auth/register", { username, password: PASSWORD });
  if (response.status !== 201) throw new Error(`Registration failed: HTTP ${response.status}`);
  const { account } = await response.json() as { account: { accountId: string; username: string } };
  const cookie = response.headers.get("set-cookie")!.split(";")[0]!;
  return { cookie, account };
}

/** Event-driven inbox: a closed wire fails immediately, not after a generic observation timeout. */
export class Wire {
  readonly messages: ServerMessage[] = [];
  private readonly listeners = new Set<() => void>();
  private ended = false;
  private request = 0;
  private constructor(readonly socket: WebSocket) {
    socket.on("message", raw => {
      this.messages.push(JSON.parse(raw.toString()) as ServerMessage);
      for (const listener of this.listeners) listener();
    });
    socket.on("close", () => { this.ended = true; for (const listener of this.listeners) listener(); });
  }
  static async open(origin: string, credential: SessionCredentialResponse, hello: Partial<ClientHello> = {}) {
    const socket = new WebSocket(`${origin.replace(/^http/, "ws")}/ws`, { origin: TEST_ORIGIN });
    const wire = new Wire(socket);
    await once(socket, "open");
    socket.send(JSON.stringify({ v: PROTOCOL_VERSION, type: "hello", sessionId: credential.sessionId, playerId: credential.playerId, reconnectToken: credential.reconnectToken,
      contentIdentity: PRODUCTION_CONTENT.contentIdentity, ...hello }));
    return wire;
  }
  async wait(predicate: (message: ServerMessage) => boolean, after = 0): Promise<ServerMessage> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { cleanup(); reject(new Error(`Wire condition timed out (seed 60): ${this.messages.slice(-8).map(m => m.type === "snapshot" ? `snapshot revision=${m.revision} control=${m.controlRevision}` : m.type === "ack" ? `ack request=${m.requestId} accepted=${m.accepted} revision=${m.committedRevision}` : `error code=${m.code}`).join("; ")}`)); }, 5_000);
      const cleanup = () => { clearTimeout(timer); this.listeners.delete(check); };
      const check = () => {
        const message = this.messages.slice(after).find(predicate);
        if (message) { cleanup(); resolve(message); }
        else if (this.ended) { cleanup(); reject(new Error("Wire closed before the expected message")); }
      };
      this.listeners.add(check); check();
    });
  }
  async snapshot(predicate: (snapshot: ServerSnapshot) => boolean = () => true, after = 0): Promise<ServerSnapshot> {
    return await this.wait(m => m.type === "snapshot" && predicate(m), after) as ServerSnapshot;
  }
  async intent(intent: SessionIntent): Promise<ServerSnapshot> {
    const previous = this.messages.filter((m): m is ServerSnapshot => m.type === "snapshot").at(-1);
    if (!previous) throw new Error("Wait for a snapshot before input");
    const requestId = `wire-request-${++this.request}`;
    const after = this.messages.length;
    this.socket.send(JSON.stringify({ v: PROTOCOL_VERSION, type: "intent", requestId, expectedRevision: previous.revision, intent }));
    const ack = await this.wait(m => m.type === "ack" && m.requestId === requestId, after);
    if (ack.type !== "ack" || !ack.accepted) {
      const error = this.messages.find(m => m.type === "error" && m.requestId === requestId);
      throw new Error(`Intent ${intent.type} rejected at revision ${previous.revision}: ${error?.type === "error" ? error.code : "no code"}`);
    }
    return await this.snapshot(m => m.revision >= ack.committedRevision, after);
  }
  async close() {
    if (this.socket.readyState === WebSocket.CLOSED) return;
    const closed = once(this.socket, "close");
    this.socket.close();
    await closed;
  }
}
