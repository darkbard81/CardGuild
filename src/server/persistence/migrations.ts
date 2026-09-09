import type { DatabaseSync } from "node:sqlite";

/**
 * Append-only. Each entry is applied once, in order, and the applied count is kept in
 * `PRAGMA user_version`, so startup migration is deterministic and re-running is a no-op.
 */
export const MIGRATIONS: readonly string[] = [
  // COLLATE NOCASE folds ASCII only, which is total here because the auth service
  // restricts usernames to an ASCII allowlist before they ever reach this table.
  `CREATE TABLE accounts (
     account_id    TEXT PRIMARY KEY,
     username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
     password_hash TEXT NOT NULL,
     created_at    INTEGER NOT NULL
   ) STRICT;
   CREATE TABLE auth_sessions (
     token_digest TEXT PRIMARY KEY,
     account_id   TEXT NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
     created_at   INTEGER NOT NULL,
     expires_at   INTEGER NOT NULL
   ) STRICT;
   CREATE INDEX auth_sessions_account ON auth_sessions(account_id);
   CREATE INDEX auth_sessions_expiry ON auth_sessions(expires_at);
   CREATE TABLE campaigns (
     campaign_id         TEXT PRIMARY KEY,
     owner_account_id    TEXT NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
     name                TEXT NOT NULL,
     campaign_revision   INTEGER NOT NULL DEFAULT 0,
     save_schema_version INTEGER,
     content_pack_id     TEXT,
     content_pack_version TEXT,
     content_fingerprint TEXT,
     snapshot_json       TEXT,
     snapshot_hash       TEXT,
     created_at          INTEGER NOT NULL,
     updated_at          INTEGER NOT NULL
   ) STRICT;
   CREATE INDEX campaigns_owner ON campaigns(owner_account_id, updated_at DESC);`,
];

function userVersion(database: DatabaseSync): number {
  const row = database.prepare("PRAGMA user_version").get();
  const value = row?.["user_version"];
  return typeof value === "number" ? value : 0;
}

/** Returns the schema version the database is on after migrating. */
export function migrate(database: DatabaseSync): number {
  const applied = userVersion(database);
  if (applied > MIGRATIONS.length) {
    throw new Error(`Database schema version ${applied} is newer than this build supports.`);
  }
  for (let version = applied; version < MIGRATIONS.length; version += 1) {
    const statements = MIGRATIONS[version];
    if (!statements) continue;
    database.exec("BEGIN IMMEDIATE");
    try {
      database.exec(statements);
      // PRAGMA does not accept bound parameters, and the value is a loop index we own.
      database.exec(`PRAGMA user_version = ${version + 1}`);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
  return MIGRATIONS.length;
}
