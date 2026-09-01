import type { Server as HttpServer } from "node:http";

import { WebSocket, WebSocketServer, type RawData } from "ws";

import {
  MAX_WS_PAYLOAD_BYTES,
  PROTOCOL_VERSION,
  parseClientMessage,
  type ClientHello,
  type ProtocolErrorCode,
  type ServerError,
} from "../protocol";
import type { SessionConnection } from "./session-host";
import type { SessionStore } from "./session-store";
import { createOpaqueId } from "./credentials";

export interface WebSocketGatewayOptions {
  readonly allowedOrigins: ReadonlySet<string>;
  readonly helloDeadlineMs?: number;
  readonly heartbeatMs?: number;
  readonly onInternalError?: (error: unknown) => void;
}

function errorMessage(code: ProtocolErrorCode, message: string): ServerError {
  return { v: 2, type: "error", code, message };
}

function send(socket: WebSocket, message: unknown): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function rawText(data: RawData): string {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  return data.toString("utf8");
}

function classifyMessage(data: RawData):
  | { readonly ok: true; readonly value: ReturnType<typeof parseClientMessage> & { readonly ok: true } }
  | { readonly ok: false; readonly code: "INVALID_MESSAGE" | "PROTOCOL_MISMATCH"; readonly error: string } {
  const text = rawText(data);
  try {
    const value = JSON.parse(text) as unknown;
    if (value && typeof value === "object" && "v" in value && (value as { readonly v?: unknown }).v !== PROTOCOL_VERSION) {
      return {
        ok: false,
        code: "PROTOCOL_MISMATCH",
        error: "Only protocol version " + String(PROTOCOL_VERSION) + " is supported.",
      };
    }
  } catch {
    return { ok: false, code: "INVALID_MESSAGE", error: "Message is not valid JSON." };
  }
  const parsed = parseClientMessage(text);
  return parsed.ok
    ? { ok: true, value: parsed }
    : { ok: false, code: "INVALID_MESSAGE", error: parsed.error };
}

export function attachWebSocketGateway(
  server: HttpServer,
  store: SessionStore,
  options: WebSocketGatewayOptions,
): { readonly close: () => Promise<void> } {
  const webSockets = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_WS_PAYLOAD_BYTES,
    perMessageDeflate: false,
  });
  const alive = new Map<WebSocket, boolean>();

  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", "http://cardguild.local");
    const origin = request.headers.origin;
    if (url.pathname !== "/ws" || (origin && !options.allowedOrigins.has(origin))) {
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    webSockets.handleUpgrade(request, socket, head, (webSocket) => webSockets.emit("connection", webSocket, request));
  });

  webSockets.on("connection", (socket) => {
    alive.set(socket, true);
    socket.on("error", () => {
      // Protocol errors such as maxPayload violations are followed by a close.
    });
    const connectionId = createOpaqueId("socket");
    let identity: { readonly sessionId: string; readonly playerId: string } | null = null;
    let messageQueue: Promise<void> = Promise.resolve();
    const deadline = setTimeout(() => {
      if (!identity) socket.close(4003, "hello timeout");
    }, options.helloDeadlineMs ?? 5_000);
    socket.on("pong", () => alive.set(socket, true));

    async function handleIncoming(data: RawData, isBinary: boolean): Promise<void> {
      if (isBinary) {
        send(socket, errorMessage("INVALID_MESSAGE", "Binary gameplay messages are not supported."));
        socket.close(1003, "text JSON required");
        return;
      }
      const classified = classifyMessage(data);
      if (!classified.ok) {
        send(socket, errorMessage(classified.code, classified.error));
        return;
      }
      const message = classified.value.value;
      if (!identity) {
        if (message.type !== "hello") {
          send(socket, errorMessage("UNAUTHENTICATED", "The first message must be hello."));
          return;
        }
        const hello: ClientHello = message;
        const host = store.get(hello.sessionId);
        if (!host) {
          send(socket, errorMessage("SESSION_NOT_FOUND", "Session was not found."));
          socket.close(4004, "session not found");
          return;
        }
        const connection: SessionConnection = {
          id: connectionId,
          send: (serverMessage) => send(socket, serverMessage),
          close: (code, reason) => socket.close(code, reason),
        };
        const attached = await host.attach(hello.playerId, hello.reconnectToken, hello.contentIdentity, connection);
        if (!attached.ok) {
          send(socket, errorMessage(attached.code, attached.message));
          socket.close(4003, attached.code.toLowerCase());
          return;
        }
        identity = { sessionId: hello.sessionId, playerId: hello.playerId };
        clearTimeout(deadline);
        return;
      }
      if (message.type !== "intent") {
        send(socket, errorMessage("INVALID_MESSAGE", "hello is only valid as the first message."));
        return;
      }
      const host = store.get(identity.sessionId);
      if (!host) {
        socket.close(1011, "session authority unavailable");
        return;
      }
      await host.handleIntent(identity.playerId, message);
    }

    socket.on("message", (data, isBinary) => {
      const operation = messageQueue.then(
        () => handleIncoming(data, isBinary),
        () => handleIncoming(data, isBinary),
      );
      messageQueue = operation.catch((error: unknown) => {
        try {
          options.onInternalError?.(error);
        } catch {
          // An observer failure must not escape the transport error boundary.
        }
        if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
          socket.close(1011, "session authority failure");
        }
      });
    });
    socket.on("close", () => {
      clearTimeout(deadline);
      alive.delete(socket);
      if (identity) void store.get(identity.sessionId)?.detach(identity.playerId, connectionId);
    });
  });

  const heartbeat = setInterval(() => {
    for (const socket of webSockets.clients) {
      if (!alive.get(socket)) {
        socket.terminate();
        continue;
      }
      alive.set(socket, false);
      socket.ping();
    }
  }, options.heartbeatMs ?? 30_000);

  return {
    close: () => new Promise<void>((resolve) => {
      clearInterval(heartbeat);
      for (const socket of webSockets.clients) socket.terminate();
      webSockets.close(() => resolve());
    }),
  };
}
