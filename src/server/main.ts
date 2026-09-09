import path from "node:path";
import process from "node:process";

import { PRODUCTION_CONTENT } from "../content/production-content";
import { DEFAULT_AUTH_TTL_MS } from "./auth-service";
import { deriveCookieSecure } from "./cookies";
import { createOpaqueId, createReconnectCredential } from "./credentials";
import { resolveDatabasePath } from "./database-path";
import { createSqlitePersistence } from "./persistence";
import { startCardGuildServer } from "./server";

// node:sqlite needs an experimental flag before Node 24; failing here beats failing at the
// first login with a stack trace from deep inside the driver.
const nodeMajor = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
if (nodeMajor < 24) throw new Error(`CardGuild requires Node 24 or newer, but this is ${process.versions.node}.`);

const port = Number.parseInt(process.env.CARDGUILD_PORT ?? "8787", 10);
const host = process.env.CARDGUILD_HOST ?? "127.0.0.1";
const allowedOrigins = new Set(
  (process.env.CARDGUILD_ALLOWED_ORIGINS ?? `http://127.0.0.1:4173,http://localhost:4173,http://${host}:${port}`)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);
const authTtlDays = Number.parseFloat(process.env.CARDGUILD_AUTH_TTL_DAYS ?? "");
const authTtlMs = Number.isFinite(authTtlDays) && authTtlDays > 0
  ? authTtlDays * 24 * 60 * 60 * 1000
  : DEFAULT_AUTH_TTL_MS;
const databasePath = resolveDatabasePath();
const configuredSeed = process.env.CARDGUILD_ADVENTURE_SEED;
const adventureSeed = configuredSeed === undefined ? null : Number.parseInt(configuredSeed, 10);
if (adventureSeed !== null && !Number.isInteger(adventureSeed)) {
  throw new Error("CARDGUILD_ADVENTURE_SEED must be an integer when provided.");
}

const running = await startCardGuildServer({
  context: {
    pack: PRODUCTION_CONTENT.pack,
    adventureId: PRODUCTION_CONTENT.adventureId,
  },
  host,
  port,
  allowedOrigins,
  staticRoot: path.resolve(process.cwd(), "dist"),
  persistence: createSqlitePersistence(databasePath),
  authTtlMs,
  cookie: {
    secure: deriveCookieSecure(allowedOrigins, process.env.CARDGUILD_COOKIE_SECURE),
    ttlMs: authTtlMs,
  },
  sources: adventureSeed === null ? undefined : {
    sessionId: () => createOpaqueId("session"),
    playerId: () => createOpaqueId("player"),
    reconnectCredential: createReconnectCredential,
    adventureSeed: () => adventureSeed,
  },
});

process.stdout.write(`CardGuild co-op server listening at ${running.origin}\n`);
process.stdout.write(`Campaign database: ${databasePath}\n`);

async function shutdown(): Promise<void> {
  await running.close();
  process.exitCode = 0;
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
