import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { migrate } from "./migrations";
import {
  USERNAME_TAKEN,
  type AccountRecord,
  type AuthSessionRecord,
  type CampaignRecord,
  type CampaignSaveLookup,
  type CampaignSaveRecord,
  type Persistence,
} from "./types";

/** node:sqlite hands back null-prototype rows of loose SQL values, so every read is narrowed here. */
type SqlRow = Record<string, unknown>;

function readText(row: SqlRow, column: string): string {
  const value = row[column];
  if (typeof value !== "string") throw new Error(`Column "${column}" is not text.`);
  return value;
}

function readInteger(row: SqlRow, column: string): number {
  const value = row[column];
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  throw new Error(`Column "${column}" is not an integer.`);
}

function hasValue(row: SqlRow, column: string): boolean {
  const value = row[column];
  return value !== null && value !== undefined;
}

export const MEMORY_DATABASE = ":memory:";

export function openDatabase(filePath: string): DatabaseSync {
  // Opening a file in a directory that does not exist fails with an opaque SQLite error,
  // which on a fresh deployment reads as "the server is broken" rather than "make the dir".
  if (filePath !== MEMORY_DATABASE) mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
  const database = new DatabaseSync(filePath);
  // WAL keeps readers off the single authority writer. It must run outside a transaction,
  // and it is silently a no-op for ":memory:", so only a file database is really in WAL.
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA busy_timeout = 5000");
  migrate(database);
  return database;
}

function toAccount(row: SqlRow): AccountRecord {
  return {
    accountId: readText(row, "account_id"),
    username: readText(row, "username"),
    passwordHash: readText(row, "password_hash"),
    createdAt: readInteger(row, "created_at"),
  };
}

function toAuthSession(row: SqlRow): AuthSessionRecord {
  return {
    tokenDigest: readText(row, "token_digest"),
    accountId: readText(row, "account_id"),
    createdAt: readInteger(row, "created_at"),
    expiresAt: readInteger(row, "expires_at"),
  };
}

function toCampaign(row: SqlRow): CampaignRecord {
  return {
    campaignId: readText(row, "campaign_id"),
    ownerAccountId: readText(row, "owner_account_id"),
    name: readText(row, "name"),
    campaignRevision: readInteger(row, "campaign_revision"),
    hasSave: hasValue(row, "snapshot_json"),
    createdAt: readInteger(row, "created_at"),
    updatedAt: readInteger(row, "updated_at"),
  };
}

/** Every save column is written by one statement, so all of them are set or none are. */
const SAVE_COLUMNS = [
  "save_schema_version",
  "content_pack_id",
  "content_pack_version",
  "content_fingerprint",
  "snapshot_json",
  "snapshot_hash",
] as const;

function toCampaignSave(row: SqlRow): CampaignSaveRecord {
  return {
    campaignId: readText(row, "campaign_id"),
    ownerAccountId: readText(row, "owner_account_id"),
    campaignRevision: readInteger(row, "campaign_revision"),
    saveSchemaVersion: readInteger(row, "save_schema_version"),
    contentIdentity: {
      packId: readText(row, "content_pack_id"),
      packVersion: readText(row, "content_pack_version"),
      fingerprint: readText(row, "content_fingerprint"),
    },
    snapshotJson: readText(row, "snapshot_json"),
    snapshotHash: readText(row, "snapshot_hash"),
    updatedAt: readInteger(row, "updated_at"),
  };
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed/i.test(error.message);
}

export function createPersistence(database: DatabaseSync): Persistence {
  const insertAccount = database.prepare(
    "INSERT INTO accounts (account_id, username, password_hash, created_at) VALUES (?, ?, ?, ?)",
  );
  const selectAccountById = database.prepare("SELECT * FROM accounts WHERE account_id = ?");
  const selectAccountByName = database.prepare("SELECT * FROM accounts WHERE username = ? COLLATE NOCASE");
  const insertAuthSession = database.prepare(
    "INSERT INTO auth_sessions (token_digest, account_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
  );
  const selectAuthSession = database.prepare(
    "SELECT * FROM auth_sessions WHERE token_digest = ? AND expires_at > ?",
  );
  const deleteAuthSession = database.prepare("DELETE FROM auth_sessions WHERE token_digest = ?");
  const deleteExpiredAuthSessions = database.prepare("DELETE FROM auth_sessions WHERE expires_at <= ?");
  const insertCampaign = database.prepare(
    `INSERT INTO campaigns (campaign_id, owner_account_id, name, campaign_revision, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const selectCampaignsByOwner = database.prepare(
    "SELECT * FROM campaigns WHERE owner_account_id = ? ORDER BY updated_at DESC",
  );
  const selectOwnedCampaign = database.prepare(
    "SELECT * FROM campaigns WHERE campaign_id = ? AND owner_account_id = ?",
  );
  const deleteOwnedCampaign = database.prepare(
    "DELETE FROM campaigns WHERE campaign_id = ? AND owner_account_id = ?",
  );
  // A single compare-and-swap UPDATE. Splitting this per column would let a crash or a
  // stale writer leave the snapshot, its hash and its content identity from different
  // generations in the same row.
  const commitCampaignSave = database.prepare(
    `UPDATE campaigns
     SET campaign_revision    = campaign_revision + 1,
         save_schema_version  = ?,
         content_pack_id      = ?,
         content_pack_version = ?,
         content_fingerprint  = ?,
         snapshot_json        = ?,
         snapshot_hash        = ?,
         updated_at           = ?
     WHERE campaign_id = ?
       AND owner_account_id = ?
       AND campaign_revision = ?`,
  );

  return {
    accounts: {
      create(account) {
        try {
          insertAccount.run(account.accountId, account.username, account.passwordHash, account.createdAt);
        } catch (error) {
          if (isUniqueViolation(error)) throw new Error(USERNAME_TAKEN, { cause: error });
          throw error;
        }
        return account;
      },
      findById(accountId) {
        const row = selectAccountById.get(accountId);
        return row ? toAccount(row) : undefined;
      },
      findByUsername(username) {
        const row = selectAccountByName.get(username);
        return row ? toAccount(row) : undefined;
      },
    },
    authSessions: {
      create(session) {
        insertAuthSession.run(session.tokenDigest, session.accountId, session.createdAt, session.expiresAt);
        return session;
      },
      findValid(tokenDigest, now) {
        const row = selectAuthSession.get(tokenDigest, now);
        return row ? toAuthSession(row) : undefined;
      },
      delete(tokenDigest) {
        deleteAuthSession.run(tokenDigest);
      },
      deleteExpired(now) {
        return Number(deleteExpiredAuthSessions.run(now).changes);
      },
    },
    campaigns: {
      create(campaign) {
        insertCampaign.run(
          campaign.campaignId,
          campaign.ownerAccountId,
          campaign.name,
          campaign.campaignRevision,
          campaign.createdAt,
          campaign.updatedAt,
        );
        return campaign;
      },
      listByOwner(ownerAccountId) {
        return selectCampaignsByOwner.all(ownerAccountId).map(toCampaign);
      },
      findOwned(campaignId, ownerAccountId) {
        const row = selectOwnedCampaign.get(campaignId, ownerAccountId);
        return row ? toCampaign(row) : undefined;
      },
      delete(campaignId, ownerAccountId) {
        return Number(deleteOwnedCampaign.run(campaignId, ownerAccountId).changes) > 0;
      },
      loadOwnedSave(campaignId, ownerAccountId): CampaignSaveLookup {
        const row = selectOwnedCampaign.get(campaignId, ownerAccountId);
        if (!row) return { status: "not-found" };
        const campaignRevision = readInteger(row, "campaign_revision");
        const present = SAVE_COLUMNS.filter((column) => hasValue(row, column)).length;
        if (present === 0) return { status: "empty", campaignRevision };
        if (present !== SAVE_COLUMNS.length) return { status: "partial", campaignRevision };
        return { status: "loaded", record: toCampaignSave(row) };
      },
      commitSave(input) {
        const changes = Number(commitCampaignSave.run(
          input.saveSchemaVersion,
          input.contentIdentity.packId,
          input.contentIdentity.packVersion,
          input.contentIdentity.fingerprint,
          input.snapshotJson,
          input.snapshotHash,
          input.updatedAt,
          input.campaignId,
          input.ownerAccountId,
          input.expectedCampaignRevision,
        ).changes);
        if (changes === 1) return { committed: true, campaignRevision: input.expectedCampaignRevision + 1 };
        // Zero changes is either "the campaign is gone" or "somebody else committed first",
        // and the caller has to tell those apart to know whether to retire or to report.
        const current = selectOwnedCampaign.get(input.campaignId, input.ownerAccountId);
        return { committed: false, reason: current ? "revision-conflict" : "not-found" };
      },
    },
    close() {
      database.close();
    },
  };
}

export function createSqlitePersistence(filePath: string): Persistence {
  return createPersistence(openDatabase(filePath));
}
