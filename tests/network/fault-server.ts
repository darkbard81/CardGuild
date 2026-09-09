/**
 * A CardGuild server that can be killed at an exact point in a durable Campaign write.
 *
 * M9-3's crash contract is about the database being the authority, so it cannot be tested
 * inside the test process: the point is that the process dies. This child server injects the
 * fault around `commitSave` and then calls `process.exit`, leaving the real file database
 * behind for the parent test to reopen.
 *
 * Environment:
 *   CARDGUILD_TEST_DB         required, path to the file database
 *   CARDGUILD_TEST_FAULT      "none" | "before" | "after" (relative to the durable write)
 *   CARDGUILD_TEST_FAULT_AT   1-based ordinal of the commit to fault on
 *   CARDGUILD_TEST_ACCOUNT    "<username>:<password>" to seed before listening
 *   CARDGUILD_TEST_ORIGIN     allowed WebSocket origin
 */
import process from "node:process";

import { PRODUCTION_CONTENT } from "../../src/content/production-content";
import { createAuthService } from "../../src/server/auth-service";
import { createOpaqueId, createReconnectCredential } from "../../src/server/credentials";
import { createSqlitePersistence, type Persistence } from "../../src/server/persistence";
import { startCardGuildServer } from "../../src/server/server";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

const databasePath = required("CARDGUILD_TEST_DB");
const faultMode = process.env["CARDGUILD_TEST_FAULT"] ?? "none";
const faultAt = Number.parseInt(process.env["CARDGUILD_TEST_FAULT_AT"] ?? "0", 10);
const origin = process.env["CARDGUILD_TEST_ORIGIN"] ?? "http://cardguild.test";

const persistence = createSqlitePersistence(databasePath);
const seed = process.env["CARDGUILD_TEST_ACCOUNT"];
if (seed) {
  const separator = seed.indexOf(":");
  await createAuthService(persistence).createAccount(seed.slice(0, separator), seed.slice(separator + 1));
}

let commits = 0;
const campaigns = persistence.campaigns;
const faulting: Persistence = {
  ...persistence,
  campaigns: {
    ...campaigns,
    commitSave(input) {
      commits += 1;
      if (faultMode === "before" && commits === faultAt) {
        process.stdout.write(`FAULT before commit ${String(commits)}\n`);
        process.exit(9);
      }
      const result = campaigns.commitSave(input);
      // The write is durable and the caller never learns it succeeded: exactly the window
      // where a client has seen no ACK for gameplay the database already holds.
      if (faultMode === "after" && commits === faultAt) {
        process.stdout.write(`FAULT after commit ${String(commits)}\n`);
        process.exit(9);
      }
      return result;
    },
  },
};

const running = await startCardGuildServer({
  context: { pack: PRODUCTION_CONTENT.pack, adventureId: PRODUCTION_CONTENT.adventureId },
  allowedOrigins: new Set([origin]),
  heartbeatMs: 60_000,
  persistence: faulting,
  // A fixed seed keeps the recovered gameplay comparable across processes.
  sources: {
    sessionId: () => createOpaqueId("session"),
    playerId: () => createOpaqueId("player"),
    reconnectCredential: createReconnectCredential,
    adventureSeed: () => 1,
  },
});

process.stdout.write(`READY ${running.origin}\n`);
process.once("SIGTERM", () => void running.close().then(() => process.exit(0)));
