import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import {
  INVALID_PASSWORD,
  INVALID_USERNAME,
  USERNAME_TAKEN,
  createAuthService,
  type AuthService,
  type AuthSources,
} from "../../src/server/auth-service";
import { digestToken } from "../../src/server/credentials";
import { createPersistence, migrate, type Persistence } from "../../src/server/persistence";

interface Harness {
  readonly auth: AuthService;
  readonly persistence: Persistence;
  advance(ms: number): void;
}

function harness(ttlMs = 1_000): Harness {
  const database = new DatabaseSync(":memory:");
  migrate(database);
  const persistence = createPersistence(database);
  let clock = 1_000;
  let tokens = 0;
  let accounts = 0;
  const sources: AuthSources = {
    now: () => clock,
    accountId: () => `account_${++accounts}`,
    authToken: () => `token-${++tokens}`,
  };
  return {
    auth: createAuthService(persistence, ttlMs, sources),
    persistence,
    advance: (ms) => { clock += ms; },
  };
}

describe("account creation", () => {
  it("refuses a username that already exists in any casing", async () => {
    const { auth } = harness();
    await auth.createAccount("Aerin", "correct horse battery");
    await expect(auth.createAccount("aerin", "another password")).rejects.toThrow(USERNAME_TAKEN);
  });

  it("restricts usernames to the ASCII set the schema can fold, and refuses short passwords", async () => {
    const { auth } = harness();
    for (const username of ["ab", "-leading", "a".repeat(33), "hero name", "Ärin"]) {
      await expect(auth.createAccount(username, "correct horse battery")).rejects.toThrow(INVALID_USERNAME);
    }
    await expect(auth.createAccount("aerin", "short")).rejects.toThrow(INVALID_PASSWORD);
    await expect(auth.createAccount("aerin.the-brave_1", "correct horse battery")).resolves.toBeDefined();
  });

  it("stores a hash rather than the password", async () => {
    const { auth, persistence } = harness();
    await auth.createAccount("aerin", "correct horse battery");
    const stored = persistence.accounts.findByUsername("aerin");
    expect(stored?.passwordHash).not.toContain("correct horse battery");
    expect(stored?.passwordHash.startsWith("scrypt$")).toBe(true);
  });
});

describe("login", () => {
  it("answers an unknown username and a wrong password identically", async () => {
    const { auth } = harness();
    await auth.createAccount("aerin", "correct horse battery");
    expect(await auth.login("aerin", "wrong password")).toBeNull();
    expect(await auth.login("nobody", "correct horse battery")).toBeNull();
    expect(await auth.login("aerin", "correct horse battery")).not.toBeNull();
  });

  it("hands back a token and never the password hash", async () => {
    const { auth } = harness();
    const account = await auth.createAccount("aerin", "correct horse battery");
    const grant = await auth.login("AERIN", "correct horse battery");

    expect(grant?.account).toEqual({ accountId: account.accountId, username: "aerin" });
    expect(JSON.stringify(grant?.account)).not.toContain("scrypt$");
    expect(grant?.token).toBeTruthy();
  });
});

describe("auth session lifetime", () => {
  it("stops authenticating once the session has expired", async () => {
    const { auth, advance } = harness(1_000);
    await auth.createAccount("aerin", "correct horse battery");
    const grant = await auth.login("aerin", "correct horse battery");

    expect(auth.authenticate(grant?.token)?.username).toBe("aerin");
    advance(999);
    expect(auth.authenticate(grant?.token)?.username).toBe("aerin");
    advance(1);
    expect(auth.authenticate(grant?.token)).toBeNull();
  });

  it("sweeps the expired row on the miss it causes, so nothing accumulates", async () => {
    const { auth, persistence, advance } = harness(1_000);
    await auth.createAccount("aerin", "correct horse battery");
    const grant = await auth.login("aerin", "correct horse battery");
    advance(2_000);

    expect(auth.authenticate(grant?.token)).toBeNull();
    expect(persistence.authSessions.findValid(digestToken("token-1"), 0)).toBeUndefined();
  });

  it("drops the session on logout and treats a missing or unknown token as anonymous", async () => {
    const { auth } = harness();
    await auth.createAccount("aerin", "correct horse battery");
    const grant = await auth.login("aerin", "correct horse battery");

    auth.logout(grant?.token);
    expect(auth.authenticate(grant?.token)).toBeNull();
    // Logging out twice, or with nothing, is not an error.
    auth.logout(grant?.token);
    auth.logout(undefined);
    expect(auth.authenticate(undefined)).toBeNull();
    expect(auth.authenticate("never issued")).toBeNull();
  });

  it("keeps two accounts' sessions apart", async () => {
    const { auth } = harness();
    await auth.createAccount("aerin", "correct horse battery");
    await auth.createAccount("brom", "another good password");
    const aerin = await auth.login("aerin", "correct horse battery");
    const brom = await auth.login("brom", "another good password");

    expect(auth.authenticate(aerin?.token)?.username).toBe("aerin");
    expect(auth.authenticate(brom?.token)?.username).toBe("brom");
    auth.logout(aerin?.token);
    expect(auth.authenticate(brom?.token)?.username).toBe("brom");
  });
});
