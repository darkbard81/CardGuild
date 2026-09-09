import { DatabaseSync } from "node:sqlite";

import { migrate } from "./migrations";
import {
  USERNAME_TAKEN,
  type AccountRecord,
  type AuthSessionRecord,
  type CampaignRecord,
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

export function openDatabase(path: string): DatabaseSync {
  const database = new DatabaseSync(path);
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
    },
    close() {
      database.close();
    },
  };
}

export function createSqlitePersistence(path: string): Persistence {
  return createPersistence(openDatabase(path));
}
