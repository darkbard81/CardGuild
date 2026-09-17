import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createSqlitePersistence } from "../../src/server/persistence/sqlite-persistence";
import type { Persistence } from "../../src/server/persistence/types";

export async function diskStore() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cardguild-contract-"));
  const databasePath = path.join(directory, "campaign.sqlite");
  let persistence: Persistence = createSqlitePersistence(databasePath);
  let closed = false;
  return {
    directory, databasePath,
    get persistence() { return persistence; },
    reopen() { persistence.close(); persistence = createSqlitePersistence(databasePath); return persistence; },
    async close(databaseAlreadyClosed = false) {
      if (closed) return;
      closed = true;
      try { if (!databaseAlreadyClosed) persistence.close(); } finally { await rm(directory, { recursive: true, force: true }); }
    },
  };
}

export function owner(persistence: Persistence, accountId = "account-contract") {
  return persistence.accounts.create({ accountId, username: accountId, passwordHash: "not-used-for-login", createdAt: 1 });
}
