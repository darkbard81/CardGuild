import type { IncomingMessage, ServerResponse } from "node:http";

import type { ProtocolErrorCode } from "../protocol";
import type { AuthService, PublicAccount } from "./auth-service";
import type { CampaignService } from "./campaign-service";
import { AUTH_COOKIE, authCookie, clearedAuthCookie, parseCookies, type CookieConfig } from "./cookies";
import type { CampaignRecord } from "./persistence";
import type { SessionStore } from "./session-store";

const MAX_HTTP_BODY_BYTES = 16 * 1024;

/**
 * HTTP-only failure codes. They deliberately do not join `ProtocolErrorCode`: the wire
 * protocol is unchanged by M9-2, and adding a member there would be a protocol change.
 */
export type ApiErrorCode = ProtocolErrorCode | "CAMPAIGN_NOT_FOUND" | "SAVE_NOT_FOUND";

export interface HttpApiDependencies {
  readonly store: SessionStore;
  readonly auth: AuthService;
  readonly campaigns: CampaignService;
  readonly cookie: CookieConfig;
}

function json(response: ServerResponse, status: number, body: unknown, setCookie?: string): void {
  const payload = JSON.stringify(body);
  const headers: Record<string, string> = {
    "content-type": "application/json; charset=utf-8",
    "content-length": String(Buffer.byteLength(payload)),
    "cache-control": "no-store",
  };
  if (setCookie) headers["set-cookie"] = setCookie;
  response.writeHead(status, headers);
  response.end(payload);
}

function empty(response: ServerResponse, status: number, setCookie?: string): void {
  const headers: Record<string, string> = { "cache-control": "no-store" };
  if (setCookie) headers["set-cookie"] = setCookie;
  response.writeHead(status, headers);
  response.end();
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

/** Every body parser is an exact-key allowlist, so an unexpected field is a rejection. */
function fields(body: unknown, allowed: readonly string[]): Readonly<Record<string, unknown>> {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("INVALID_BODY");
  const record = body as Record<string, unknown>;
  if (Object.keys(record).some((key) => !allowed.includes(key))) throw new Error("INVALID_BODY");
  return record;
}

function optionalString(value: unknown): string | undefined {
  if (value !== undefined && typeof value !== "string") throw new Error("INVALID_BODY");
  return value;
}

function requiredString(value: unknown): string {
  if (typeof value !== "string") throw new Error("INVALID_BODY");
  return value;
}

function displayName(body: unknown): string | undefined {
  return optionalString(fields(body, ["displayName"])["displayName"]);
}

function credentials(body: unknown): { readonly username: string; readonly password: string } {
  const record = fields(body, ["username", "password"]);
  return { username: requiredString(record["username"]), password: requiredString(record["password"]) };
}

function newCampaign(body: unknown): { readonly name: string; readonly displayName: string | undefined } {
  const record = fields(body, ["name", "displayName"]);
  return { name: requiredString(record["name"]), displayName: optionalString(record["displayName"]) };
}

function failureStatus(code: ApiErrorCode): number {
  if (code === "UNAUTHENTICATED") return 401;
  if (code === "FORBIDDEN") return 403;
  if (code === "SESSION_NOT_FOUND" || code === "CAMPAIGN_NOT_FOUND") return 404;
  if (code === "SESSION_FULL" || code === "ROSTER_LOCKED" || code === "SAVE_NOT_FOUND") return 409;
  return 400;
}

function fail(response: ServerResponse, code: ApiErrorCode, message: string): void {
  json(response, failureStatus(code), { code, message });
}

function badRequest(response: ServerResponse, error: unknown): void {
  json(response, error instanceof Error && error.message === "REQUEST_TOO_LARGE" ? 413 : 400, {
    code: "INVALID_MESSAGE",
    message: "Request body must be a small JSON object with the documented fields.",
  });
}

/** What the client is allowed to see about a campaign. The owning account id is not part of it. */
function publicCampaign(campaign: CampaignRecord): unknown {
  return {
    campaignId: campaign.campaignId,
    name: campaign.name,
    hasSave: campaign.hasSave,
    createdAt: campaign.createdAt,
    updatedAt: campaign.updatedAt,
  };
}

export function createHttpApi(
  deps: HttpApiDependencies,
): (request: IncomingMessage, response: ServerResponse) => Promise<boolean> {
  const { store, auth, campaigns, cookie } = deps;

  const signedIn = (request: IncomingMessage): PublicAccount | null =>
    auth.authenticate(parseCookies(request.headers.cookie).get(AUTH_COOKIE));

  return async (request, response) => {
    const url = new URL(request.url ?? "/", "http://cardguild.local");
    const method = request.method;

    if (method === "GET" && url.pathname === "/api/health") {
      json(response, 200, { ok: true });
      return true;
    }

    if (method === "POST" && url.pathname === "/api/auth/login") {
      try {
        const { username, password } = credentials(await readJsonBody(request));
        const grant = await auth.login(username, password);
        // An unknown username and a wrong password are the same answer, at the same cost.
        if (!grant) fail(response, "UNAUTHENTICATED", "Username or password is incorrect.");
        else json(response, 200, { account: grant.account }, authCookie(grant.token, cookie));
      } catch (error) {
        badRequest(response, error);
      }
      return true;
    }

    if (method === "POST" && url.pathname === "/api/auth/logout") {
      auth.logout(parseCookies(request.headers.cookie).get(AUTH_COOKIE));
      // Logging out when nobody is logged in is not an error.
      empty(response, 204, clearedAuthCookie(cookie));
      return true;
    }

    if (method === "GET" && url.pathname === "/api/auth/me") {
      // Anonymous is an answer, not a failure: the client asks this on every load.
      json(response, 200, { account: signedIn(request) });
      return true;
    }

    if (method === "POST" && url.pathname === "/api/campaigns") {
      const account = signedIn(request);
      if (!account) {
        fail(response, "UNAUTHENTICATED", "Hosting a campaign requires signing in.");
        return true;
      }
      try {
        const body = newCampaign(await readJsonBody(request));
        const created = campaigns.create(account.accountId, body.name, body.displayName);
        json(response, 201, {
          campaign: publicCampaign(created.campaign),
          ...created.credential,
          invite: { sessionId: created.credential.sessionId },
        });
      } catch (error) {
        badRequest(response, error);
      }
      return true;
    }

    if (method === "GET" && url.pathname === "/api/campaigns") {
      const account = signedIn(request);
      if (!account) fail(response, "UNAUTHENTICATED", "Listing campaigns requires signing in.");
      else json(response, 200, { campaigns: campaigns.list(account.accountId).map(publicCampaign) });
      return true;
    }

    const resume = /^\/api\/campaigns\/([^/]+)\/continue$/.exec(url.pathname);
    if (method === "POST" && resume?.[1]) {
      const account = signedIn(request);
      if (!account) {
        fail(response, "UNAUTHENTICATED", "Continuing a campaign requires signing in.");
        return true;
      }
      const campaign = campaigns.findOwned(account.accountId, decodeURIComponent(resume[1]));
      // Another account's campaign is indistinguishable from one that does not exist.
      if (!campaign) fail(response, "CAMPAIGN_NOT_FOUND", "Campaign was not found.");
      else fail(response, "SAVE_NOT_FOUND", "This campaign has no saved progress to continue yet.");
      return true;
    }

    if (method === "POST" && url.pathname === "/api/sessions") {
      try {
        const credential = store.create(displayName(await readJsonBody(request)));
        json(response, 201, { ...credential, invite: { sessionId: credential.sessionId } });
      } catch (error) {
        badRequest(response, error);
      }
      return true;
    }

    const join = /^\/api\/sessions\/([^/]+)\/join$/.exec(url.pathname);
    if (method === "POST" && join?.[1]) {
      try {
        const result = await store.join(decodeURIComponent(join[1]), displayName(await readJsonBody(request)));
        if (!result.accepted) {
          const code = result.result?.errorCode ?? "SESSION_NOT_FOUND";
          fail(response, code, result.result?.error ?? "Session was not found.");
        } else {
          json(response, 200, result.credential);
        }
      } catch (error) {
        badRequest(response, error);
      }
      return true;
    }

    return false;
  };
}
