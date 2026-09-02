import type { IncomingMessage, ServerResponse } from "node:http";

import type { ProtocolErrorCode } from "../protocol";
import type { SessionStore } from "./session-store";

const MAX_HTTP_BODY_BYTES = 16 * 1024;

function json(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
  });
  response.end(payload);
}
async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    bytes += buffer.length;
    if (bytes > MAX_HTTP_BODY_BYTES) throw new Error("REQUEST_TOO_LARGE");
    chunks.push(buffer);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

function displayName(body: unknown): string | undefined {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("INVALID_BODY");
  const keys = Object.keys(body);
  if (keys.some((key) => key !== "displayName")) throw new Error("INVALID_BODY");
  const value = (body as { readonly displayName?: unknown }).displayName;
  if (value !== undefined && typeof value !== "string") throw new Error("INVALID_BODY");
  return value;
}

function failureStatus(code: ProtocolErrorCode): number {
  if (code === "SESSION_NOT_FOUND") return 404;
  if (code === "SESSION_FULL" || code === "ROSTER_LOCKED") return 409;
  return 400;
}

export function createHttpApi(store: SessionStore): (request: IncomingMessage, response: ServerResponse) => Promise<boolean> {
  return async (request, response) => {
    const url = new URL(request.url ?? "/", "http://cardguild.local");
    if (request.method === "GET" && url.pathname === "/api/health") {
      json(response, 200, { ok: true });
      return true;
    }
    if (request.method === "POST" && url.pathname === "/api/sessions") {
      try {
        const credential = store.create(displayName(await readJsonBody(request)));
        json(response, 201, {
          ...credential,
          invite: { sessionId: credential.sessionId },
        });
      } catch (error) {
        json(response, error instanceof Error && error.message === "REQUEST_TOO_LARGE" ? 413 : 400, {
          code: "INVALID_MESSAGE",
          message: "Request body must be a small JSON object with an optional displayName.",
        });
      }
      return true;
    }
    const join = /^\/api\/sessions\/([^/]+)\/join$/.exec(url.pathname);
    if (request.method === "POST" && join?.[1]) {
      try {
        const result = await store.join(decodeURIComponent(join[1]), displayName(await readJsonBody(request)));
        if (!result.accepted) {
          const code = result.result?.errorCode ?? "SESSION_NOT_FOUND";
          json(response, failureStatus(code), { code, message: result.result?.error ?? "Session was not found." });
        } else {
          json(response, 200, result.credential);
        }
      } catch (error) {
        json(response, error instanceof Error && error.message === "REQUEST_TOO_LARGE" ? 413 : 400, {
          code: "INVALID_MESSAGE",
          message: "Request body must be a small JSON object with an optional displayName.",
        });
      }
      return true;
    }
    return false;
  };
}
