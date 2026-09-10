import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocket, WebSocketServer } from "ws";

import type { ServerAck, ServerError, ServerMessage, ServerSnapshot } from "../../../src/protocol";

/**
 * A WebSocket server that says only what a test tells it to, when the test says it.
 *
 * The helper contract under test is about *ordering* — a frame that arrived before a close,
 * a close that arrived before a frame, a close with no frame at all. The real server cannot
 * be asked to produce those orders on demand, and a mocked socket would prove nothing about
 * the events `ws` actually emits. So this is a real server with a hand on the valve.
 */
export interface FakeSocketServer {
  readonly origin: string;
  /** The server side of the next (or current) connection, once it has been accepted. */
  accept(): Promise<WebSocket>;
  /** Every frame this server has received, in order, parsed as JSON. */
  readonly received: unknown[];
  dispose(): Promise<void>;
}

export async function startFakeSocketServer(): Promise<FakeSocketServer> {
  const http: Server = createServer();
  const sockets = new WebSocketServer({ server: http, path: "/ws" });
  const received: unknown[] = [];
  const accepted: WebSocket[] = [];
  let announce: ((socket: WebSocket) => void) | null = null;

  sockets.on("connection", (socket) => {
    socket.on("message", (data) => received.push(JSON.parse(data.toString())));
    // Nothing else is registered: this server never answers on its own.
    accepted.push(socket);
    announce?.(socket);
  });

  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", () => resolve()));
  const address = http.address() as AddressInfo;

  return {
    origin: `http://127.0.0.1:${String(address.port)}`,
    received,
    accept: async () => {
      const already = accepted[0];
      if (already) return already;
      return await new Promise<WebSocket>((resolve) => { announce = resolve; });
    },
    dispose: async () => {
      for (const socket of accepted) socket.terminate();
      await new Promise<void>((resolve) => sockets.close(() => resolve()));
      await new Promise<void>((resolve) => http.close(() => resolve()));
    },
  };
}

export function ackFrame(requestId: string, accepted: boolean, committedRevision: number): ServerAck {
  return { v: 7, type: "ack", requestId, accepted, committedRevision };
}

export function errorFrame(code: ServerError["code"], message: string, requestId?: string): ServerError {
  return { v: 7, type: "error", code, message, ...(requestId === undefined ? {} : { requestId }) };
}

/**
 * The smallest snapshot the drive loop will act on: a resume lobby, which it answers with
 * `resume-adventure`. Nothing here needs a real Adventure — the subject is the wait, not the
 * rules.
 */
export function resumeLobbySnapshot(revision: number, contentIdentity: ServerSnapshot["state"]["contentIdentity"]): ServerSnapshot {
  return {
    v: 7,
    type: "snapshot",
    revision,
    controlRevision: 1,
    gameplayHash: "fake",
    state: {
      version: 3,
      sessionId: "fake-session",
      revision,
      contentIdentity,
      lifecycle: "resume-lobby",
      hostPlayerId: "p1",
      adventureSeed: 1,
      seats: [{ seat: 1, playerId: "p1", displayName: "Host" }],
      partyPrepared: false,
      partySlots: [],
      guestClaims: { byMemberId: {} },
      adventure: null,
      combat: null,
    },
    control: { connectedPlayerIds: ["p1"], effectiveControllerByMemberId: {} },
    events: [],
  };
}

export function send(socket: WebSocket, message: ServerMessage): void {
  socket.send(JSON.stringify(message));
}
