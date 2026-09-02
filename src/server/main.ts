import path from "node:path";
import process from "node:process";

import { PRODUCTION_CONTENT } from "../content";
import { createOpaqueId, createReconnectCredential } from "./credentials";
import { startCardGuildServer } from "./server";

const port = Number.parseInt(process.env.CARDGUILD_PORT ?? "8787", 10);
const host = process.env.CARDGUILD_HOST ?? "127.0.0.1";
const allowedOrigins = new Set(
  (process.env.CARDGUILD_ALLOWED_ORIGINS ?? `http://127.0.0.1:4173,http://localhost:4173,http://${host}:${port}`)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);
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
  sources: adventureSeed === null ? undefined : {
    sessionId: () => createOpaqueId("session"),
    playerId: () => createOpaqueId("player"),
    reconnectCredential: createReconnectCredential,
    adventureSeed: () => adventureSeed,
  },
});

process.stdout.write(`CardGuild co-op server listening at ${running.origin}\n`);

async function shutdown(): Promise<void> {
  await running.close();
  process.exitCode = 0;
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
