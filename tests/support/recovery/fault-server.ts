/**
 * A CardGuild server that can be killed at an exact point in a durable Campaign write.
 *
 * M9-3's crash contract is about the database being the authority, so it cannot be tested
 * inside the test process: the point is that the process dies. This child server injects
 * the fault around `commitSave` and then `SIGKILL`s itself, leaving the real file database
 * behind for the parent test to reopen.
 *
 * SIGKILL rather than `process.exit` on purpose: an orderly exit would run shutdown
 * handlers and close the database, which is the one thing a crash never gets to do.
 *
 * The fault is inert until the parent arms it over IPC. Counting from process start would
 * mean counting the setup writes too, so a test that gains one more preparation step would
 * quietly start aiming at a different transition.
 *
 * Environment:
 *   CARDGUILD_TEST_DB       required, path to the file database
 *   CARDGUILD_TEST_MARKER   required, where to record the fault before dying
 *   CARDGUILD_TEST_ACCOUNT  "<username>:<password>" to seed before listening
 *   CARDGUILD_TEST_ORIGIN   allowed WebSocket origin
 *   CARDGUILD_TEST_SEED     adventure seed, so recovered gameplay is comparable
 */
import { writeFileSync } from "node:fs";
import process from "node:process";

import { PRODUCTION_CONTENT } from "../../../src/content/production-content";
import { createAuthService } from "../../../src/server/auth-service";
import type { CampaignSaveV1 } from "../../../src/server/campaign-save";
import { createOpaqueId, createReconnectCredential } from "../../../src/server/credentials";
import { createSqlitePersistence, type Persistence } from "../../../src/server/persistence";
import { startCardGuildServer } from "../../../src/server/server";
import type { FaultSpec, FaultTarget } from "../../support/recovery/fault-child";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

const databasePath = required("CARDGUILD_TEST_DB");
const markerPath = required("CARDGUILD_TEST_MARKER");
const origin = process.env["CARDGUILD_TEST_ORIGIN"] ?? "http://cardguild.test";
const adventureSeed = Number.parseInt(process.env["CARDGUILD_TEST_SEED"] ?? "1", 10);

const persistence = createSqlitePersistence(databasePath);
const seed = process.env["CARDGUILD_TEST_ACCOUNT"];
if (seed) {
  const separator = seed.indexOf(":");
  await createAuthService(persistence).createAccount(seed.slice(0, separator), seed.slice(separator + 1));
}

function totalOwned(save: CampaignSaveV1): number {
  const collection = save.adventure.collection;
  const sum = (counts: Readonly<Record<string, number>>): number =>
    Object.values(counts).reduce((total, count) => total + count, 0);
  return sum(collection.equipment) + sum(collection.cards);
}

function highestLevel(save: CampaignSaveV1): number {
  return Object.values(save.adventure.party.members)
    .reduce((best, member) => Math.max(best, member.progression.level), 0);
}

/** Whether the last logged command was played by the server AI rather than by a player. */
function lastCommandIsEnemy(save: CampaignSaveV1): boolean {
  const combat = save.combat;
  const last = combat?.commandLog.at(-1);
  return Boolean(last && combat?.actors[last.actorId]?.team === "enemies");
}

/**
 * What this candidate does to the campaign, read by comparing it with what is stored.
 * Nothing here asks the server what it was doing: the save is the only evidence a crash
 * leaves behind, so the classifier reads the same thing the recovery does.
 */
function matches(target: FaultTarget, previous: CampaignSaveV1 | null, next: CampaignSaveV1): boolean {
  if (target === "any") return true;
  if (target === "migration") {
    return Boolean(previous) && previous?.contentIdentity.fingerprint !== next.contentIdentity.fingerprint;
  }
  if (!previous) return false;
  switch (target) {
    case "encounter-complete":
      return next.adventure.completedEncounterIds.length > previous.adventure.completedEncounterIds.length;
    case "level-up":
      return highestLevel(next) > highestLevel(previous);
    case "adventure-complete":
      return next.adventure.phase === "complete" && previous.adventure.phase !== "complete";
    case "reward":
      return totalOwned(next) > totalOwned(previous);
    case "combat-command":
      return Boolean(next.combat && previous.combat) &&
        (next.combat?.sequence ?? 0) > (previous.combat?.sequence ?? 0);
    case "ai-command":
      return Boolean(next.combat && previous.combat) &&
        (next.combat?.sequence ?? 0) > (previous.combat?.sequence ?? 0) &&
        lastCommandIsEnemy(next);
  }
}

let armed: FaultSpec | null = null;
let matched = 0;

process.on("message", (message: unknown) => {
  const value = message as (FaultSpec & { readonly type?: string }) | null;
  if (value?.type !== "arm") return;
  armed = { when: value.when, target: value.target, nth: value.nth ?? 1 };
  matched = 0;
  process.send?.({ type: "armed" });
});

function die(when: "before" | "after", campaignRevision: number): never {
  // Written synchronously: a SIGKILL takes the process before an async stdout write to a
  // pipe would ever flush, so the marker file is the only reliable evidence.
  writeFileSync(markerPath, JSON.stringify({
    when,
    target: armed?.target ?? "any",
    matched,
    campaignRevision,
  }));
  process.kill(process.pid, "SIGKILL");
  throw new Error("unreachable");
}

const campaigns = persistence.campaigns;
const faulting: Persistence = {
  ...persistence,
  campaigns: {
    ...campaigns,
    commitSave(input) {
      const spec = armed;
      if (!spec) return campaigns.commitSave(input);
      const lookup = campaigns.loadOwnedSave(input.campaignId, input.ownerAccountId);
      const previous = lookup.status === "loaded"
        ? JSON.parse(lookup.record.snapshotJson) as CampaignSaveV1
        : null;
      const next = JSON.parse(input.snapshotJson) as CampaignSaveV1;
      if (!matches(spec.target, previous, next)) return campaigns.commitSave(input);
      matched += 1;
      if (matched !== (spec.nth ?? 1)) return campaigns.commitSave(input);
      if (spec.when === "before") die("before", input.expectedCampaignRevision);
      const result = campaigns.commitSave(input);
      // Only a write that actually landed opens the "after" window. A refused CAS is a
      // transition the database does not hold, so killing there would be a "before" fault
      // wearing the wrong name — and the recovery assertions would be judging the wrong
      // contract. A refused commit is handed back so the server can report it normally.
      if (!result.committed) return result;
      // The write is durable and the caller never learns it succeeded: exactly the window
      // where a client has seen no ACK for gameplay the database already holds.
      die("after", result.campaignRevision);
    },
  },
};

const running = await startCardGuildServer({
  context: { pack: PRODUCTION_CONTENT.pack, adventureId: PRODUCTION_CONTENT.adventureId },
  allowedOrigins: new Set([origin]),
  heartbeatMs: 60_000,
  persistence: faulting,
  sources: {
    sessionId: () => createOpaqueId("session"),
    playerId: () => createOpaqueId("player"),
    reconnectCredential: createReconnectCredential,
    adventureSeed: () => adventureSeed,
  },
});

process.stdout.write(`READY ${running.origin}\n`);

// `on`, not `once`: a repeated signal must reach the shared idempotent shutdown rather
// than Node's default handler, which would kill the process mid-flush.
async function shutdown(): Promise<void> {
  try {
    await running.close();
    process.exit(0);
  } catch (error) {
    process.stderr.write(`SHUTDOWN FAILED ${String(error)}\n`);
    process.exit(1);
  }
}
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
