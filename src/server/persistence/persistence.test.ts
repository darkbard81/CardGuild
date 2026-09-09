import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import { hashPassword, verifyPassword } from "../password";
import { MIGRATIONS, migrate } from "./migrations";
import { createPersistence } from "./sqlite-persistence";
import { USERNAME_TAKEN, type Persistence } from "./types";

function memoryPersistence(): Persistence {
  // node:sqlite enforces foreign keys by default, so the schema's ON DELETE CASCADE is live.
  const database = new DatabaseSync(":memory:");
  migrate(database);
  return createPersistence(database);
}

function account(accountId: string, username: string): Parameters<Persistence["accounts"]["create"]>[0] {
  return { accountId, username, passwordHash: "scrypt$1$1$1$c2FsdA$a2V5", createdAt: 1_000 };
}

describe("M9-2 persistence schema", () => {
  it("migrates deterministically and refuses a database from a newer build", () => {
    const database = new DatabaseSync(":memory:");
    expect(migrate(database)).toBe(MIGRATIONS.length);
    // Re-running is a no-op rather than a duplicate-table error.
    expect(migrate(database)).toBe(MIGRATIONS.length);
    expect(database.prepare("PRAGMA user_version").get()?.["user_version"]).toBe(MIGRATIONS.length);

    database.exec(`PRAGMA user_version = ${MIGRATIONS.length + 1}`);
    expect(() => migrate(database)).toThrow("newer than this build");
    database.close();
  });
});

describe("M9-2 account ownership", () => {
  it("rejects a duplicate username regardless of case, without disturbing the first account", () => {
    const store = memoryPersistence();
    store.accounts.create(account("acc_1", "Aerin"));
    expect(() => store.accounts.create(account("acc_2", "aerin"))).toThrow(USERNAME_TAKEN);
    expect(store.accounts.findByUsername("AERIN")?.accountId).toBe("acc_1");
    expect(store.accounts.findById("acc_2")).toBeUndefined();
    store.close();
  });

  it("keeps every campaign readable only through its owning account", () => {
    const store = memoryPersistence();
    store.accounts.create(account("acc_1", "owner"));
    store.accounts.create(account("acc_2", "stranger"));
    const owned = store.campaigns.create({
      campaignId: "camp_1", ownerAccountId: "acc_1", name: "Goblin Trouble",
      campaignRevision: 0, hasSave: false, createdAt: 5, updatedAt: 5,
    });

    expect(store.campaigns.findOwned("camp_1", "acc_1")).toEqual(owned);
    // The stranger gets "not found", not "forbidden": a campaign's existence is private too.
    expect(store.campaigns.findOwned("camp_1", "acc_2")).toBeUndefined();
    expect(store.campaigns.listByOwner("acc_2")).toEqual([]);
    expect(store.campaigns.listByOwner("acc_1").map((row) => row.campaignId)).toEqual(["camp_1"]);
    // M9-2 never writes a snapshot, so Continue has nothing to restore yet.
    expect(owned.hasSave).toBe(false);
    store.close();
  });

  it("refuses a campaign that no account owns", () => {
    const store = memoryPersistence();
    store.accounts.create(account("acc_1", "owner"));
    // Ownership is enforced by the schema, not only by the callers.
    expect(() => store.campaigns.create({
      campaignId: "camp_orphan", ownerAccountId: "acc_missing", name: "Orphan",
      campaignRevision: 0, hasSave: false, createdAt: 5, updatedAt: 5,
    })).toThrow(/FOREIGN KEY/i);
    store.close();
  });
});

describe("M9-2 auth sessions", () => {
  it("stops honouring a token at its expiry and after an explicit logout", () => {
    const store = memoryPersistence();
    store.accounts.create(account("acc_1", "owner"));
    store.authSessions.create({ tokenDigest: "digest-1", accountId: "acc_1", createdAt: 0, expiresAt: 100 });

    expect(store.authSessions.findValid("digest-1", 99)?.accountId).toBe("acc_1");
    // Expiry is part of the lookup, so no caller can forget to check it.
    expect(store.authSessions.findValid("digest-1", 100)).toBeUndefined();
    expect(store.authSessions.findValid("digest-1", 101)).toBeUndefined();

    store.authSessions.delete("digest-1");
    expect(store.authSessions.findValid("digest-1", 1)).toBeUndefined();
    store.close();
  });

  it("sweeps only the sessions that have already expired", () => {
    const store = memoryPersistence();
    store.accounts.create(account("acc_1", "owner"));
    store.authSessions.create({ tokenDigest: "old", accountId: "acc_1", createdAt: 0, expiresAt: 10 });
    store.authSessions.create({ tokenDigest: "live", accountId: "acc_1", createdAt: 0, expiresAt: 1_000 });

    expect(store.authSessions.deleteExpired(500)).toBe(1);
    expect(store.authSessions.findValid("live", 500)?.tokenDigest).toBe("live");
    store.close();
  });

  it("refuses a session that no account owns", () => {
    const store = memoryPersistence();
    store.accounts.create(account("acc_1", "owner"));
    expect(() => store.authSessions.create({
      tokenDigest: "digest-2", accountId: "acc_missing", createdAt: 0, expiresAt: 1_000,
    })).toThrow(/FOREIGN KEY/i);
    store.close();
  });
});

describe("M9-2 password storage", () => {
  it("never stores the password and accepts only the right one", async () => {
    const password = "correct horse battery staple";
    const stored = await hashPassword(password);

    expect(stored).not.toContain(password);
    expect(stored.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword(password, stored)).toBe(true);
    expect(await verifyPassword("wrong password", stored)).toBe(false);
    // A different salt each time, so equal passwords do not produce equal rows.
    expect(await hashPassword(password)).not.toBe(stored);
  });

  it("reads a corrupt or foreign hash as a failed login instead of throwing", async () => {
    for (const stored of ["", "plaintext", "scrypt$0$8$1$c2FsdA$a2V5", "argon2$1$2$3$4$5", "scrypt$32768$8$1$$"]) {
      expect(await verifyPassword("anything", stored)).toBe(false);
    }
  });
});
