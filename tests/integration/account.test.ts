import { DatabaseSync } from "node:sqlite";
import { WebSocket } from "ws";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PRODUCTION_CONTENT } from "../../src/content";
import type { ServerMessage, ServerSnapshot } from "../../src/protocol";
import { createAuthService } from "../../src/server/auth-service";
import { AUTH_COOKIE } from "../../src/server/cookies";
import { digestReconnectToken } from "../../src/server/credentials";
import { createPersistence, migrate, type Persistence } from "../../src/server/persistence";
import { startCardGuildServer, type RunningCardGuildServer } from "../../src/server/server";
import type { SessionCredentialResponse } from "../../src/server/session-store";
import { hashSessionGameplayState } from "../../src/session";

const TEST_ORIGIN = "http://cardguild.test";
const OWNER = { username: "owner-host", password: "owner password" };
const STRANGER = { username: "stranger-host", password: "stranger password" };

interface Response<T> {
  readonly status: number;
  readonly body: T;
  readonly setCookie: string | null;
}

/** Node's fetch has no cookie jar, so the auth cookie is carried by hand. */
async function request<T>(
  origin: string,
  method: string,
  path: string,
  options: { readonly body?: unknown; readonly cookie?: string } = {},
): Promise<Response<T>> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (options.cookie) headers["cookie"] = options.cookie;
  const response = await fetch(new URL(path, origin), {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: (text ? JSON.parse(text) : null) as T,
    setCookie: response.headers.get("set-cookie"),
  };
}

function cookieFrom(setCookie: string | null): string {
  const value = setCookie?.split(";")[0];
  if (!value) throw new Error("Response carried no auth cookie.");
  return value;
}

async function snapshotOf(origin: string, credential: SessionCredentialResponse): Promise<ServerSnapshot> {
  const socket = new WebSocket(origin.replace(/^http/, "ws") + "/ws", { origin: TEST_ORIGIN });
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once("open", () => resolve());
      socket.once("error", reject);
    });
    const snapshot = new Promise<ServerSnapshot>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("No snapshot arrived.")), 5_000);
      socket.on("message", (data) => {
        const message = JSON.parse(data.toString()) as ServerMessage;
        if (message.type === "snapshot") {
          clearTimeout(timer);
          resolve(message);
        }
      });
    });
    socket.send(JSON.stringify({
      v: 7,
      type: "hello",
      sessionId: credential.sessionId,
      playerId: credential.playerId,
      reconnectToken: credential.reconnectToken,
      contentIdentity: PRODUCTION_CONTENT.contentIdentity,
    }));
    return await snapshot;
  } finally {
    socket.close();
  }
}

describe("host identity and campaign ownership over real HTTP", () => {
  let running: RunningCardGuildServer | null = null;

  async function start(authTtlMs?: number): Promise<RunningCardGuildServer> {
    const database = new DatabaseSync(":memory:");
    migrate(database);
    const persistence: Persistence = createPersistence(database);
    const auth = createAuthService(persistence);
    await auth.createAccount(OWNER.username, OWNER.password);
    await auth.createAccount(STRANGER.username, STRANGER.password);

    let sessions = 0;
    let players = 0;
    let tokens = 0;
    running = await startCardGuildServer({
      context: { pack: PRODUCTION_CONTENT.pack, adventureId: PRODUCTION_CONTENT.adventureId },
      allowedOrigins: new Set([TEST_ORIGIN]),
      heartbeatMs: 60_000,
      persistence,
      authTtlMs,
      sources: {
        sessionId: () => "session-" + String(++sessions),
        playerId: () => "player-" + String(++players),
        reconnectCredential: () => {
          const token = "reconnect-" + String(++tokens);
          return { token, digest: digestReconnectToken(token) };
        },
        adventureSeed: () => 1,
      },
    });
    return running;
  }

  async function signIn(server: RunningCardGuildServer, who = OWNER): Promise<string> {
    const result = await request(server.origin, "POST", "/api/auth/login", { body: who });
    expect(result.status).toBe(200);
    return cookieFrom(result.setCookie);
  }

  afterEach(async () => {
    if (running) await running.close();
    running = null;
    vi.restoreAllMocks();
  });

  it("signs a host in with a cookie the page cannot read, and reports who that is", async () => {
    const server = await start();
    const login = await request<{ account: { accountId: string; username: string } }>(
      server.origin, "POST", "/api/auth/login", { body: OWNER },
    );

    expect(login.status).toBe(200);
    expect(login.body.account.username).toBe(OWNER.username);
    expect(login.setCookie).toContain("HttpOnly");
    expect(login.setCookie).toContain("SameSite=Lax");
    expect(login.setCookie).toContain(AUTH_COOKIE);

    const me = await request<{ account: { username: string } | null }>(
      server.origin, "GET", "/api/auth/me", { cookie: cookieFrom(login.setCookie) },
    );
    expect(me.status).toBe(200);
    expect(me.body.account?.username).toBe(OWNER.username);
  });

  it("creates an account, signs it straight in, and lets it own a campaign at once", async () => {
    const server = await start();
    const created = await request<{ account: { accountId: string; username: string } }>(
      server.origin, "POST", "/api/auth/register", { body: { username: "new-host", password: "new host password" } },
    );

    expect(created.status).toBe(201);
    expect(created.body.account.username).toBe("new-host");
    // Signing up signs you in: the same cookie login issues, with the same protections.
    expect(created.setCookie).toContain("HttpOnly");
    expect(created.setCookie).toContain("SameSite=Lax");
    expect(created.setCookie).toContain(AUTH_COOKIE);
    const cookie = cookieFrom(created.setCookie);

    const me = await request<{ account: { username: string } | null }>(
      server.origin, "GET", "/api/auth/me", { cookie });
    expect(me.body.account?.username).toBe("new-host");

    // The account is a real owner from its first request, not a second-class one.
    const campaign = await request<{ campaign: { campaignId: string } }>(
      server.origin, "POST", "/api/campaigns", { body: { name: "First Campaign" }, cookie });
    expect(campaign.status).toBe(201);
    const listed = await request<{ campaigns: readonly { readonly name: string }[] }>(
      server.origin, "GET", "/api/campaigns", { cookie });
    expect(listed.body.campaigns.map((entry) => entry.name)).toEqual(["First Campaign"]);

    // And the password it chose is the password it can sign back in with.
    const again = await request(server.origin, "POST", "/api/auth/login", {
      body: { username: "new-host", password: "new host password" },
    });
    expect(again.status).toBe(200);
  });

  it("refuses a taken username, a malformed one, a short password and an unexpected field", async () => {
    const server = await start();

    // Case-insensitive, because the accounts table folds case for uniqueness.
    const taken = await request<{ code: string; message: string }>(
      server.origin, "POST", "/api/auth/register", { body: { username: OWNER.username.toUpperCase(), password: "another password" } },
    );
    expect(taken.status).toBe(409);
    expect(taken.body.code).toBe("USERNAME_TAKEN");
    expect(taken.setCookie).toBeNull();

    const badName = await request<{ code: string; message: string }>(
      server.origin, "POST", "/api/auth/register", { body: { username: "no", password: "long enough password" } },
    );
    expect(badName.status).toBe(400);
    expect(badName.body.code).toBe("INVALID_USERNAME");
    // The refusal names the rule, so the next attempt is not a guess.
    expect(badName.body.message).toContain("3-32 characters");

    const badPassword = await request<{ code: string; message: string }>(
      server.origin, "POST", "/api/auth/register", { body: { username: "short-pass-host", password: "short" } },
    );
    expect(badPassword.status).toBe(400);
    expect(badPassword.body.code).toBe("INVALID_PASSWORD");

    // The body allowlist is the same one every other route uses.
    const extra = await request<{ code: string }>(
      server.origin, "POST", "/api/auth/register",
      { body: { username: "extra-host", password: "long enough password", accountId: "account_forged" } },
    );
    expect(extra.status).toBe(400);
    expect(extra.body.code).toBe("INVALID_MESSAGE");

    // None of the refusals left an account behind.
    for (const username of ["no", "short-pass-host", "extra-host"]) {
      const attempt = await request(server.origin, "POST", "/api/auth/login", {
        body: { username, password: "long enough password" },
      });
      expect(attempt.status).toBe(401);
    }
  });

  it("answers a wrong password and an unknown account identically, and issues no cookie", async () => {
    const server = await start();
    const wrongPassword = await request(server.origin, "POST", "/api/auth/login",
      { body: { username: OWNER.username, password: "not the password" } });
    const unknownAccount = await request(server.origin, "POST", "/api/auth/login",
      { body: { username: "nobody-at-all", password: OWNER.password } });

    expect(wrongPassword.status).toBe(401);
    expect(wrongPassword.setCookie).toBeNull();
    // The two failures are indistinguishable, so login cannot enumerate accounts.
    expect(unknownAccount.status).toBe(wrongPassword.status);
    expect(unknownAccount.body).toEqual(wrongPassword.body);
  });

  it("treats a missing session as anonymous rather than as an error", async () => {
    const server = await start();
    const me = await request<{ account: null }>(server.origin, "GET", "/api/auth/me");
    // 200 rather than 401: the client asks this on every load, and anonymous is an answer.
    expect(me.status).toBe(200);
    expect(me.body.account).toBeNull();
  });

  it("stops honouring the cookie after logout, and logging out twice is not an error", async () => {
    const server = await start();
    const cookie = await signIn(server);

    const logout = await request(server.origin, "POST", "/api/auth/logout", { cookie });
    expect(logout.status).toBe(204);
    expect(logout.setCookie).toContain("Max-Age=0");

    const after = await request<{ account: null }>(server.origin, "GET", "/api/auth/me", { cookie });
    expect(after.body.account).toBeNull();
    expect((await request(server.origin, "POST", "/api/auth/logout", { cookie })).status).toBe(204);
    expect((await request(server.origin, "POST", "/api/auth/logout")).status).toBe(204);
  });

  it("stops honouring the cookie once the session has expired", async () => {
    const server = await start(60);
    const cookie = await signIn(server);
    expect((await request<{ account: unknown }>(server.origin, "GET", "/api/auth/me", { cookie })).body.account)
      .not.toBeNull();

    await new Promise((resolve) => setTimeout(resolve, 200));
    const expired = await request<{ account: null }>(server.origin, "GET", "/api/auth/me", { cookie });
    expect(expired.body.account).toBeNull();
    expect((await request(server.origin, "GET", "/api/campaigns", { cookie })).status).toBe(401);
  });

  it("refuses every campaign route to a caller without a session", async () => {
    const server = await start();
    // A guest has no cookie at all, so this is 401 UNAUTHENTICATED, never 403.
    expect((await request(server.origin, "GET", "/api/campaigns")).status).toBe(401);
    expect((await request(server.origin, "POST", "/api/campaigns", { body: { name: "Mine" } })).status).toBe(401);
    expect((await request(server.origin, "POST", "/api/campaigns/anything/continue")).status).toBe(401);
  });

  it("opens a live session for a new campaign and lists it for its owner alone", async () => {
    const server = await start();
    const owner = await signIn(server);
    const stranger = await signIn(server, STRANGER);

    const created = await request<{ campaign: { campaignId: string; hasSave: boolean } } & SessionCredentialResponse>(
      server.origin, "POST", "/api/campaigns", { body: { name: "Goblin Trouble", displayName: "Host" }, cookie: owner },
    );
    expect(created.status).toBe(201);
    expect(created.body.campaign.hasSave).toBe(false);
    expect(created.body.seat).toBe(1);
    // The owning account id is not part of what a client may see.
    expect(JSON.stringify(created.body.campaign)).not.toContain("account");

    const mine = await request<{ campaigns: { campaignId: string }[] }>(
      server.origin, "GET", "/api/campaigns", { cookie: owner });
    expect(mine.body.campaigns.map((row) => row.campaignId)).toContain(created.body.campaign.campaignId);

    const theirs = await request<{ campaigns: { campaignId: string }[] }>(
      server.origin, "GET", "/api/campaigns", { cookie: stranger });
    expect(theirs.body.campaigns.map((row) => row.campaignId)).not.toContain(created.body.campaign.campaignId);
  });

  it("hides another account's campaign behind the same answer as one that never existed", async () => {
    const server = await start();
    const owner = await signIn(server);
    const stranger = await signIn(server, STRANGER);
    const created = await request<{ campaign: { campaignId: string } }>(
      server.origin, "POST", "/api/campaigns", { body: { name: "Goblin Trouble" }, cookie: owner });

    const foreign = await request(server.origin, "POST",
      `/api/campaigns/${created.body.campaign.campaignId}/continue`, { cookie: stranger });
    const missing = await request(server.origin, "POST", "/api/campaigns/campaign_nope/continue", { cookie: stranger });

    expect(foreign.status).toBe(404);
    expect(foreign.body).toEqual(missing.body);
  });

  it("refuses to continue the owner's own campaign while it has no saved progress", async () => {
    const server = await start();
    const owner = await signIn(server);
    const created = await request<{ campaign: { campaignId: string } }>(
      server.origin, "POST", "/api/campaigns", { body: { name: "Goblin Trouble" }, cookie: owner });

    const resumed = await request<{ code: string }>(server.origin, "POST",
      `/api/campaigns/${created.body.campaign.campaignId}/continue`, { cookie: owner });
    // M9-3 replaces only this branch with real rehydration.
    expect(resumed.status).toBe(409);
    expect(resumed.body.code).toBe("SAVE_NOT_FOUND");
  });

  it("lets a guest join a campaign's session without an account", async () => {
    const server = await start();
    const owner = await signIn(server);
    const created = await request<SessionCredentialResponse>(
      server.origin, "POST", "/api/campaigns", { body: { name: "Goblin Trouble" }, cookie: owner });

    const joined = await request<SessionCredentialResponse>(
      server.origin, "POST", `/api/sessions/${created.body.sessionId}/join`, { body: { displayName: "Guest" } });
    expect(joined.status).toBe(200);
    expect(joined.body.seat).toBe(2);
  });

  it("keeps account and campaign identity out of the gameplay snapshot and hash", async () => {
    const server = await start();
    const owner = await signIn(server);
    const stranger = await signIn(server, STRANGER);
    const created = await request<{ campaign: { campaignId: string } } & SessionCredentialResponse>(
      server.origin, "POST", "/api/campaigns", { body: { name: "Goblin Trouble" }, cookie: owner });
    const other = await request<SessionCredentialResponse>(
      server.origin, "POST", "/api/campaigns", { body: { name: "Someone else" }, cookie: stranger });

    const snapshot = await snapshotOf(server.origin, created.body);
    const serialized = JSON.stringify(snapshot);
    for (const secret of [OWNER.password, created.body.campaign.campaignId, owner.split("=")[1] ?? ""]) {
      expect(serialized).not.toContain(secret);
    }
    expect(serialized).not.toContain("scrypt$");

    // Two campaigns owned by different accounts hash identically: ownership is not gameplay.
    const ownedState = server.store.get(created.body.sessionId)!.state;
    const otherState = server.store.get(other.body.sessionId)!.state;
    expect(hashSessionGameplayState(ownedState)).toBe(hashSessionGameplayState(otherState));
  });

  it("never writes a password, token or hash to the server's own output", async () => {
    const server = await start();
    const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const cookie = await signIn(server);
    await request(server.origin, "POST", "/api/auth/login",
      { body: { username: OWNER.username, password: "not the password" } });
    await request(server.origin, "POST", "/api/campaigns", { body: { name: "Goblin Trouble" }, cookie });
    await request(server.origin, "POST", "/api/campaigns", { body: { name: "" }, cookie });
    await request(server.origin, "POST", "/api/auth/logout", { cookie });

    const written = [stdout, stderr, errors]
      .flatMap((spy) => spy.mock.calls.map((call) => String(call[0])))
      .join("\n");
    for (const secret of [OWNER.password, "not the password", cookie.split("=")[1] ?? "", "scrypt$"]) {
      expect(written).not.toContain(secret);
    }
  });
});
