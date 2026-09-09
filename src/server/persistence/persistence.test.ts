import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import { hashPassword, verifyPassword } from "../password";
import { MIGRATIONS, migrate } from "./migrations";
import { createPersistence, createSqlitePersistence, openDatabase } from "./sqlite-persistence";
import { USERNAME_TAKEN, type CampaignSaveCommit, type Persistence } from "./types";

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

describe("M9-3 campaign snapshot storage", () => {
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
  });

  function temporaryDatabasePath(): string {
    const directory = mkdtempSync(path.join(tmpdir(), "cardguild-m9-3-"));
    temporaryDirectories.push(directory);
    return path.join(directory, "campaigns.sqlite");
  }

  function seeded(store: Persistence): Persistence {
    store.accounts.create(account("acc_1", "owner"));
    store.accounts.create(account("acc_2", "stranger"));
    store.campaigns.create({
      campaignId: "camp_1", ownerAccountId: "acc_1", name: "Goblin Trouble",
      campaignRevision: 0, hasSave: false, createdAt: 5, updatedAt: 5,
    });
    return store;
  }

  function commit(revision: number, overrides: Partial<CampaignSaveCommit> = {}): CampaignSaveCommit {
    return {
      campaignId: "camp_1",
      ownerAccountId: "acc_1",
      expectedCampaignRevision: revision,
      saveSchemaVersion: 1,
      contentIdentity: { packId: "pack", packVersion: "1.0.0", fingerprint: "fp-" + String(revision) },
      snapshotJson: JSON.stringify({ generation: revision }),
      snapshotHash: "hash-" + String(revision),
      updatedAt: 1_000 + revision,
      ...overrides,
    };
  }

  it("reports a campaign that has never been played as an empty save rather than an error", () => {
    const store = seeded(memoryPersistence());

    expect(store.campaigns.loadOwnedSave("camp_1", "acc_1")).toEqual({ status: "empty", campaignRevision: 0 });
    expect(store.campaigns.loadOwnedSave("camp_1", "acc_2")).toEqual({ status: "not-found" });
    expect(store.campaigns.loadOwnedSave("camp_missing", "acc_1")).toEqual({ status: "not-found" });
    store.close();
  });

  it("commits the first save, advances the revision, and flips hasSave", () => {
    const store = seeded(memoryPersistence());

    expect(store.campaigns.commitSave(commit(0))).toEqual({ committed: true, campaignRevision: 1 });
    const lookup = store.campaigns.loadOwnedSave("camp_1", "acc_1");
    expect(lookup.status).toBe("loaded");
    if (lookup.status !== "loaded") throw new Error("Expected a loaded save.");
    // Every column comes from the same generation, because one statement wrote them all.
    expect(lookup.record).toEqual({
      campaignId: "camp_1",
      ownerAccountId: "acc_1",
      campaignRevision: 1,
      saveSchemaVersion: 1,
      contentIdentity: { packId: "pack", packVersion: "1.0.0", fingerprint: "fp-0" },
      snapshotJson: JSON.stringify({ generation: 0 }),
      snapshotHash: "hash-0",
      updatedAt: 1_000,
    });
    expect(store.campaigns.findOwned("camp_1", "acc_1")?.hasSave).toBe(true);
    expect(store.campaigns.commitSave(commit(1))).toEqual({ committed: true, campaignRevision: 2 });
    store.close();
  });

  it("refuses a stale writer's compare-and-swap without touching the stored save", () => {
    const store = seeded(memoryPersistence());
    store.campaigns.commitSave(commit(0));
    store.campaigns.commitSave(commit(1));
    const before = store.campaigns.loadOwnedSave("camp_1", "acc_1");

    // Two live writers both believing they are at revision 1: the second must lose.
    expect(store.campaigns.commitSave(commit(1, { snapshotHash: "stale" })))
      .toEqual({ committed: false, reason: "revision-conflict" });
    expect(store.campaigns.commitSave(commit(0, { snapshotHash: "older" })))
      .toEqual({ committed: false, reason: "revision-conflict" });
    expect(store.campaigns.loadOwnedSave("camp_1", "acc_1")).toEqual(before);
    store.close();
  });

  it("keeps a save private to its owner and reports a vanished campaign apart from a conflict", () => {
    const store = seeded(memoryPersistence());
    store.campaigns.commitSave(commit(0));

    expect(store.campaigns.commitSave(commit(1, { ownerAccountId: "acc_2" })))
      .toEqual({ committed: false, reason: "not-found" });
    expect(store.campaigns.commitSave(commit(0, { campaignId: "camp_missing" })))
      .toEqual({ committed: false, reason: "not-found" });
    expect(store.campaigns.loadOwnedSave("camp_1", "acc_2")).toEqual({ status: "not-found" });
    // The stranger's failed writes changed nothing the owner can see.
    const lookup = store.campaigns.loadOwnedSave("camp_1", "acc_1");
    expect(lookup.status === "loaded" && lookup.record.snapshotHash).toBe("hash-0");
    store.close();
  });

  it("treats half-written save metadata as corruption instead of reading around it", () => {
    const database = new DatabaseSync(":memory:");
    migrate(database);
    const store = seeded(createPersistence(database));
    store.campaigns.commitSave(commit(0));

    // Only a hand-edited row or a driver that broke atomicity can produce this.
    database.prepare("UPDATE campaigns SET snapshot_hash = NULL WHERE campaign_id = ?").run("camp_1");
    expect(store.campaigns.loadOwnedSave("camp_1", "acc_1")).toEqual({ status: "partial", campaignRevision: 1 });
    store.close();
  });

  it("keeps a committed save across a real file close and reopen, in WAL", () => {
    const filePath = temporaryDatabasePath();
    const first = createSqlitePersistence(filePath);
    seeded(first);
    expect(first.campaigns.commitSave(commit(0))).toEqual({ committed: true, campaignRevision: 1 });
    first.close();

    // A fresh process-equivalent handle on the same file must see the committed save. An
    // in-memory database can never show this, and WAL is silently a no-op there.
    const database = openDatabase(filePath);
    expect(database.prepare("PRAGMA journal_mode").get()?.["journal_mode"]).toBe("wal");
    const second = createPersistence(database);
    const lookup = second.campaigns.loadOwnedSave("camp_1", "acc_1");
    expect(lookup.status).toBe("loaded");
    if (lookup.status !== "loaded") throw new Error("Expected a loaded save.");
    expect(lookup.record.snapshotJson).toBe(JSON.stringify({ generation: 0 }));
    expect(lookup.record.campaignRevision).toBe(1);
    expect(second.campaigns.commitSave(commit(1))).toEqual({ committed: true, campaignRevision: 2 });
    second.close();
  });
});
