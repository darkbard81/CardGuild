import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";

import { PRODUCTION_CONTENT } from "../content";
import { hashSessionGameplayState, type SessionCoreState, type SessionIntent } from "../session";
import type { ServerMessage } from "../protocol";
import { createCampaignDurability } from "./campaign-durability";
import { LEGACY_CONTENT_IDENTITY, legacyStoredSave } from "./campaign-save.fixture";
import { INVALID_CAMPAIGN_NAME, createCampaignService, type CampaignService } from "./campaign-service";
import { digestReconnectToken } from "./credentials";
import { createPersistence, migrate, type Persistence } from "./persistence";
import { SessionStore } from "./session-store";
import type { SessionConnection } from "./session-host";

interface Harness {
  readonly campaigns: CampaignService;
  readonly persistence: Persistence;
  readonly store: SessionStore;
  readonly database: DatabaseSync;
}

const PARTY = ["hero.aerin", "hero.lyra", "hero.brom"] as const;

/** The harness issues deterministic reconnect tokens, so a test can attach as the host. */
function reconnectTokenFor(index: number): string {
  return `reconnect-${String(index)}`;
}

class TestConnection implements SessionConnection {
  public readonly messages: ServerMessage[] = [];
  public readonly closes: number[] = [];

  public constructor(public readonly id: string) {}

  public send(message: ServerMessage): void {
    this.messages.push(message);
  }

  public close(code: number): void {
    this.closes.push(code);
  }
}

function harness(): Harness {
  const database = new DatabaseSync(":memory:");
  migrate(database);
  const persistence = createPersistence(database);
  let sessions = 0;
  let players = 0;
  let tokens = 0;
  let campaigns = 0;
  const store = new SessionStore(
    { pack: PRODUCTION_CONTENT.pack, adventureId: PRODUCTION_CONTENT.adventureId },
    {
      sessionId: () => `session-${++sessions}`,
      playerId: () => `player-${++players}`,
      reconnectCredential: () => {
        const token = `reconnect-${++tokens}`;
        return { token, digest: digestReconnectToken(token) };
      },
      adventureSeed: () => 1,
    },
  );
  for (const account of ["acc_owner", "acc_stranger"]) {
    persistence.accounts.create({
      accountId: account, username: account, passwordHash: "scrypt$1$1$1$c2FsdA$a2V5", createdAt: 0,
    });
  }
  return {
    campaigns: createCampaignService(persistence, store, {
      now: () => 5_000,
      campaignId: () => `campaign-${++campaigns}`,
    }),
    persistence,
    store,
    database,
  };
}

/** Attach a connection and drive intents the way the gateway would. */
async function driver(
  harnessed: Harness,
  sessionId: string,
  playerId: string,
  reconnectToken: string,
): Promise<(requestId: string, intent: SessionIntent) => Promise<void>> {
  const host = harnessed.store.get(sessionId);
  if (!host) throw new Error(`Session "${sessionId}" is not open.`);
  const connection = new TestConnection(`socket-${sessionId}`);
  const attached = await host.attach(playerId, reconnectToken, host.state.contentIdentity, connection);
  if (!attached.ok) throw new Error(`Attach failed: ${attached.code}`);
  return async (requestId, intent) => {
    await host.handleIntent(playerId, connection.id, {
      v: 7,
      type: "intent",
      requestId,
      expectedRevision: host.state.revision,
      intent,
    });
  };
}

interface PlayedCampaign {
  readonly campaignId: string;
  readonly sessionId: string;
  readonly playerId: string;
  readonly state: SessionCoreState;
}

/** A campaign taken to a durable mid-combat save through the real intent path. */
async function playedToCombat(harnessed: Harness, tokenIndex = 1): Promise<PlayedCampaign> {
  const created = harnessed.campaigns.create("acc_owner", "Goblin Trouble", "Host");
  const send = await driver(
    harnessed,
    created.credential.sessionId,
    created.credential.playerId,
    reconnectTokenFor(tokenIndex),
  );
  await send("party", { type: "set-party-composition", actorDefinitionIds: [...PARTY] });
  await send("begin", { type: "begin-adventure" });
  await send("encounter", { type: "start-encounter" });
  const host = harnessed.store.get(created.credential.sessionId);
  if (!host) throw new Error("Session vanished mid-play.");
  return {
    campaignId: created.campaign.campaignId,
    sessionId: created.credential.sessionId,
    playerId: created.credential.playerId,
    state: host.state,
  };
}

describe("M9-2 campaign ownership", () => {
  it("opens a live session for a new campaign and remembers who owns it", () => {
    const { campaigns, store } = harness();
    const created = campaigns.create("acc_owner", "Goblin Trouble", "Host");

    expect(created.campaign.ownerAccountId).toBe("acc_owner");
    expect(created.campaign.hasSave).toBe(false);
    expect(created.credential.seat).toBe(1);
    expect(store.get(created.credential.sessionId)).toBeDefined();
    expect(campaigns.ownershipOf(created.credential.sessionId)).toEqual({
      campaignId: created.campaign.campaignId,
      ownerAccountId: "acc_owner",
    });
  });

  it("keeps ownership out of the session state, so the gameplay hash is unchanged", () => {
    const { campaigns, store } = harness();
    const owned = campaigns.create("acc_owner", "Goblin Trouble", "Host");
    const anonymous = store.create("Host");

    const ownedState = store.get(owned.credential.sessionId)!.state;
    // Account and campaign identity live beside the session, never inside it.
    expect(JSON.stringify(ownedState)).not.toContain("acc_owner");
    expect(JSON.stringify(ownedState)).not.toContain(owned.campaign.campaignId);
    // A campaign-owned session hashes exactly like the anonymous one it replaces.
    const anonymousState = store.get(anonymous.sessionId)!.state;
    expect(hashSessionGameplayState(ownedState)).toBe(hashSessionGameplayState(anonymousState));
  });

  it("hides another account's campaign instead of refusing it", () => {
    const { campaigns } = harness();
    const owned = campaigns.create("acc_owner", "Goblin Trouble");

    expect(campaigns.findOwned("acc_owner", owned.campaign.campaignId)).toEqual(owned.campaign);
    // The stranger cannot tell "not yours" from "not there".
    expect(campaigns.findOwned("acc_stranger", owned.campaign.campaignId)).toBeUndefined();
    expect(campaigns.findOwned("acc_stranger", "campaign-does-not-exist")).toBeUndefined();
    expect(campaigns.list("acc_stranger")).toEqual([]);
  });

  it("lists only the caller's own campaigns, newest first", () => {
    const { campaigns } = harness();
    const first = campaigns.create("acc_owner", "First");
    const second = campaigns.create("acc_owner", "Second");
    campaigns.create("acc_stranger", "Not mine");

    expect(campaigns.list("acc_owner").map((row) => row.campaignId).sort())
      .toEqual([first.campaign.campaignId, second.campaign.campaignId].sort());
    expect(campaigns.list("acc_owner").every((row) => row.ownerAccountId === "acc_owner")).toBe(true);
  });

  it("refuses an empty or oversized campaign name before touching the store", () => {
    const { campaigns, store } = harness();
    for (const name of ["", "   ", "n".repeat(61)]) {
      expect(() => campaigns.create("acc_owner", name)).toThrow(INVALID_CAMPAIGN_NAME);
    }
    expect(campaigns.list("acc_owner")).toEqual([]);
    expect(store.get("session-1")).toBeUndefined();
  });

  it("leaves no live session behind when the durable write fails", () => {
    const { campaigns, store } = harness();
    // An unknown owner violates the accounts foreign key, which is the durable write failing.
    expect(() => campaigns.create("acc_missing", "Orphan")).toThrow(/FOREIGN KEY/i);
    expect(store.get("session-1")).toBeUndefined();
  });

  it("leaves no campaign behind when the live session cannot be opened", () => {
    const { campaigns, store } = harness();
    const failure = new Error("Session store refused to open a session.");
    vi.spyOn(store, "create").mockImplementationOnce(() => { throw failure; });

    expect(() => campaigns.create("acc_owner", "Half made")).toThrow(failure);
    // The caller saw a failure, so nothing may remain that a later Continue could resume.
    expect(campaigns.list("acc_owner")).toEqual([]);
    vi.restoreAllMocks();
  });

  it("keeps a failed creation from taking an earlier campaign with it", () => {
    const { campaigns, store } = harness();
    const kept = campaigns.create("acc_owner", "Kept");
    vi.spyOn(store, "create").mockImplementationOnce(() => { throw new Error("no session"); });

    expect(() => campaigns.create("acc_owner", "Discarded")).toThrow("no session");
    expect(campaigns.list("acc_owner").map((row) => row.campaignId)).toEqual([kept.campaign.campaignId]);
    expect(campaigns.ownershipOf(kept.credential.sessionId)).toBeDefined();
    vi.restoreAllMocks();
  });

  it("knows nothing about a session it did not open", () => {
    const { campaigns, store } = harness();
    const anonymous = store.create("Host");
    expect(campaigns.ownershipOf(anonymous.sessionId)).toBeUndefined();
  });
});

describe("M9-3 campaign continue", () => {
  it("makes Begin Adventure the first durable save and keeps the lobby out of it", async () => {
    const harnessed = harness();
    const created = harnessed.campaigns.create("acc_owner", "Goblin Trouble", "Host");
    const send = await driver(
      harnessed,
      created.credential.sessionId,
      created.credential.playerId,
      reconnectTokenFor(1),
    );
    const owned = (): NonNullable<ReturnType<Persistence["campaigns"]["findOwned"]>> => {
      const row = harnessed.persistence.campaigns.findOwned(created.campaign.campaignId, "acc_owner");
      if (!row) throw new Error("Campaign row vanished.");
      return row;
    };

    expect(owned()).toMatchObject({ hasSave: false, campaignRevision: 0 });
    await send("party", { type: "set-party-composition", actorDefinitionIds: [...PARTY] });
    // Preparing a party in a new lobby is not durable progress yet.
    expect(owned()).toMatchObject({ hasSave: false, campaignRevision: 0 });

    await send("begin", { type: "begin-adventure" });
    expect(owned()).toMatchObject({ hasSave: true, campaignRevision: 1 });
    await send("encounter", { type: "start-encounter" });
    expect(owned().campaignRevision).toBeGreaterThan(1);
    harnessed.persistence.close();
  });

  it("restores the last committed gameplay into a fresh live session and retires the old writer", async () => {
    const harnessed = harness();
    const played = await playedToCombat(harnessed);
    const originalHost = harnessed.store.get(played.sessionId);
    const savedHash = hashSessionGameplayState(played.state);

    const result = await harnessed.campaigns.continue("acc_owner", played.campaignId, "Returning Host");

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Continue was expected to succeed.");
    expect(result.credential.sessionId).not.toBe(played.sessionId);
    expect(result.credential.playerId).not.toBe(played.playerId);
    expect(result.credential.seat).toBe(1);
    // One campaign, one live writer: the previous session is retired and dropped.
    expect(originalHost?.retired).toBe(true);
    expect(harnessed.store.get(played.sessionId)).toBeUndefined();
    expect(harnessed.campaigns.ownershipOf(played.sessionId)).toBeUndefined();
    expect(harnessed.campaigns.liveSessionOf(played.campaignId)).toBe(result.credential.sessionId);

    const restored = harnessed.store.get(result.credential.sessionId);
    if (!restored) throw new Error("Continue opened no live session.");
    expect(restored.state.lifecycle).toBe("resume-lobby");
    expect(restored.state.revision).toBe(0);
    expect(restored.state.guestClaims).toEqual({ byMemberId: {} });
    expect(hashSessionGameplayState(restored.state)).toBe(savedHash);
    expect(restored.state.combat).toEqual(played.state.combat);
    harnessed.persistence.close();
  });

  it("keeps playing whatever was committed while Continue was already waiting", async () => {
    const harnessed = harness();
    const played = await playedToCombat(harnessed);
    const host = harnessed.store.get(played.sessionId);
    if (!host) throw new Error("Session vanished.");
    const connectionId = "socket-" + played.sessionId;

    // A last gameplay intent is enqueued before Continue reaches the store, so Continue's
    // barrier must let it commit and must then read that newer save, not the older one.
    const lastPlay = host.handleIntent(played.playerId, connectionId, {
      v: 7,
      type: "intent",
      requestId: "last-play",
      expectedRevision: host.state.revision,
      intent: { type: "end-turn", facing: "north" },
    });
    const continued = harnessed.campaigns.continue("acc_owner", played.campaignId);
    await lastPlay;
    const finalHash = hashSessionGameplayState(host.state);
    const result = await continued;

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Continue was expected to succeed.");
    const restored = harnessed.store.get(result.credential.sessionId);
    expect(hashSessionGameplayState(restored!.state)).toBe(finalHash);
    expect(finalHash).not.toBe(hashSessionGameplayState(played.state));
    harnessed.persistence.close();
  });

  it("leaves the live session and the stored row untouched when the save cannot be resumed", async () => {
    const harnessed = harness();
    const played = await playedToCombat(harnessed);
    const before = harnessed.persistence.campaigns.loadOwnedSave(played.campaignId, "acc_owner");
    harnessed.database
      .prepare("UPDATE campaigns SET snapshot_json = ? WHERE campaign_id = ?")
      .run('{"saveSchemaVersion":1,"nope":true}', played.campaignId);

    const result = await harnessed.campaigns.continue("acc_owner", played.campaignId);

    expect(result).toMatchObject({ ok: false, code: "SAVE_CORRUPT" });
    // The host may still be playing in the session they already have.
    expect(harnessed.store.get(played.sessionId)?.retired).toBe(false);
    expect(harnessed.campaigns.liveSessionOf(played.campaignId)).toBe(played.sessionId);
    const after = harnessed.persistence.campaigns.loadOwnedSave(played.campaignId, "acc_owner");
    expect(after.status).toBe("loaded");
    if (after.status !== "loaded" || before.status !== "loaded") throw new Error("Expected loaded saves.");
    expect(after.record.campaignRevision).toBe(before.record.campaignRevision);
    expect(after.record.snapshotHash).toBe(before.record.snapshotHash);
    harnessed.persistence.close();
  });

  it("refuses to continue a campaign with no save, another account's campaign, or an unsupported save", async () => {
    const harnessed = harness();
    const fresh = harnessed.campaigns.create("acc_owner", "Never played", "Host");
    const played = await playedToCombat(harnessed, 2);

    expect(await harnessed.campaigns.continue("acc_owner", fresh.campaign.campaignId))
      .toMatchObject({ ok: false, code: "SAVE_NOT_FOUND" });
    expect(await harnessed.campaigns.continue("acc_stranger", played.campaignId))
      .toMatchObject({ ok: false, code: "CAMPAIGN_NOT_FOUND" });
    expect(await harnessed.campaigns.continue("acc_owner", "campaign-does-not-exist"))
      .toMatchObject({ ok: false, code: "CAMPAIGN_NOT_FOUND" });

    harnessed.database
      .prepare("UPDATE campaigns SET save_schema_version = 2, snapshot_json = json_set(snapshot_json, '$.saveSchemaVersion', 2) WHERE campaign_id = ?")
      .run(played.campaignId);
    expect(await harnessed.campaigns.continue("acc_owner", played.campaignId))
      .toMatchObject({ ok: false, code: "SAVE_SCHEMA_UNSUPPORTED" });
    // Nothing was retired by any of those refusals.
    expect(harnessed.store.get(played.sessionId)?.retired).toBe(false);
    harnessed.persistence.close();
  });

  it("serializes concurrent Continues so only the last one is the campaign's writer", async () => {
    const harnessed = harness();
    const played = await playedToCombat(harnessed);

    const [first, second] = await Promise.all([
      harnessed.campaigns.continue("acc_owner", played.campaignId),
      harnessed.campaigns.continue("acc_owner", played.campaignId),
    ]);

    if (!first.ok || !second.ok) throw new Error("Both Continues were expected to succeed.");
    expect(first.credential.sessionId).not.toBe(second.credential.sessionId);
    const writer = harnessed.campaigns.liveSessionOf(played.campaignId);
    expect(writer).toBe(second.credential.sessionId);
    // The session the first Continue opened was retired by the second, and its cleanup did
    // not take the newer mapping with it.
    expect(harnessed.store.get(first.credential.sessionId)).toBeUndefined();
    expect(harnessed.store.get(second.credential.sessionId)?.retired).toBe(false);
    expect(harnessed.campaigns.ownershipOf(second.credential.sessionId)).toEqual({
      campaignId: played.campaignId,
      ownerAccountId: "acc_owner",
    });
    harnessed.persistence.close();
  });

  it("refuses a stale writer's save through the compare-and-swap even outside the retire path", async () => {
    const harnessed = harness();
    const played = await playedToCombat(harnessed);
    const lookup = harnessed.persistence.campaigns.loadOwnedSave(played.campaignId, "acc_owner");
    if (lookup.status !== "loaded") throw new Error("Expected a loaded save.");
    // A writer that somehow survived, still holding the revision it last committed at.
    const stale = createCampaignDurability({
      campaigns: harnessed.persistence.campaigns,
      campaignId: played.campaignId,
      ownerAccountId: "acc_owner",
      campaignRevision: lookup.record.campaignRevision - 1,
      now: () => 6_000,
    });

    await expect(stale.commitGameplayTransition(
      { ...played.state, combat: null, adventure: null },
      played.state,
    )).rejects.toMatchObject({ name: "CampaignWriterRetiredError", reason: "revision-conflict" });
    const after = harnessed.persistence.campaigns.loadOwnedSave(played.campaignId, "acc_owner");
    expect(after).toEqual(lookup);
    harnessed.persistence.close();
  });

  it("stops treating a session as the campaign writer once it retires itself", async () => {
    const harnessed = harness();
    const played = await playedToCombat(harnessed);

    await harnessed.store.retire(played.sessionId, "durable write failed");

    expect(harnessed.campaigns.liveSessionOf(played.campaignId)).toBeUndefined();
    expect(harnessed.campaigns.ownershipOf(played.sessionId)).toBeUndefined();
    // Continue still works: the durable save is the authority, not the dead session.
    const result = await harnessed.campaigns.continue("acc_owner", played.campaignId);
    expect(result.ok).toBe(true);
    harnessed.persistence.close();
  });
});

describe("M9-4 campaign continue with content migration", () => {
  /** Rewrite a campaign's stored row as the previous build would have written it. */
  function rollBackToPreviousContent(harnessed: Harness, played: PlayedCampaign): number {
    const legacy = legacyStoredSave(played.state);
    const lookup = harnessed.persistence.campaigns.loadOwnedSave(played.campaignId, "acc_owner");
    if (lookup.status !== "loaded") throw new Error("Expected a stored save.");
    harnessed.database
      .prepare(
        "UPDATE campaigns SET snapshot_json = ?, snapshot_hash = ?, content_pack_version = ?, content_fingerprint = ? " +
        "WHERE campaign_id = ?",
      )
      .run(
        JSON.stringify(legacy.save),
        legacy.snapshotHash,
        LEGACY_CONTENT_IDENTITY.packVersion,
        LEGACY_CONTENT_IDENTITY.fingerprint,
        played.campaignId,
      );
    return lookup.record.campaignRevision;
  }

  it("migrates the stored save once, before the new session exists, and not again afterwards", async () => {
    const harnessed = harness();
    const played = await playedToCombat(harnessed);
    const revisionBefore = rollBackToPreviousContent(harnessed, played);
    // The live writer must be gone first, or Continue's barrier would re-save current content.
    await harnessed.store.retire(played.sessionId, "previous build");

    const result = await harnessed.campaigns.continue("acc_owner", played.campaignId, "Returning Host");

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Continue was expected to succeed.");
    const migrated = harnessed.persistence.campaigns.loadOwnedSave(played.campaignId, "acc_owner");
    if (migrated.status !== "loaded") throw new Error("Expected a stored save.");
    // Exactly one revision for exactly one migration COMMIT.
    expect(migrated.record.campaignRevision).toBe(revisionBefore + 1);
    expect(migrated.record.contentIdentity).toEqual(PRODUCTION_CONTENT.contentIdentity);

    const restored = harnessed.store.get(result.credential.sessionId);
    if (!restored) throw new Error("Continue opened no live session.");
    expect(restored.state.lifecycle).toBe("resume-lobby");
    expect(restored.state.contentIdentity).toEqual(PRODUCTION_CONTENT.contentIdentity);
    // Progress is preserved exactly: the migration pays no EXP for battles already fought.
    expect(restored.state.adventure?.completedEncounterIds).toEqual(played.state.adventure?.completedEncounterIds);
    expect(Object.values(restored.state.adventure?.party.members ?? {}).map((member) => member.progression))
      .toEqual(Object.values(played.state.adventure?.party.members ?? {}).map((member) => member.progression));
    expect(restored.state.combat?.commandLog).toEqual(played.state.combat?.commandLog);
    expect(hashSessionGameplayState(restored.state)).toBe(migrated.record.snapshotHash);

    // A second Continue finds a save that is already current, so it writes nothing.
    const again = await harnessed.campaigns.continue("acc_owner", played.campaignId, "Returning Host");
    expect(again.ok).toBe(true);
    const after = harnessed.persistence.campaigns.loadOwnedSave(played.campaignId, "acc_owner");
    if (after.status !== "loaded") throw new Error("Expected a stored save.");
    expect(after.record.campaignRevision).toBe(migrated.record.campaignRevision);
    expect(after.record.snapshotHash).toBe(migrated.record.snapshotHash);
    harnessed.persistence.close();
  });

  it("publishes no session and keeps the stored row when the migration COMMIT loses the CAS", async () => {
    const harnessed = harness();
    const played = await playedToCombat(harnessed);
    rollBackToPreviousContent(harnessed, played);
    await harnessed.store.retire(played.sessionId, "previous build");
    const before = harnessed.persistence.campaigns.loadOwnedSave(played.campaignId, "acc_owner");
    if (before.status !== "loaded") throw new Error("Expected a stored save.");
    const commitSave = vi.spyOn(harnessed.persistence.campaigns, "commitSave")
      .mockReturnValue({ committed: false, reason: "revision-conflict" });

    const result = await harnessed.campaigns.continue("acc_owner", played.campaignId);

    expect(result).toMatchObject({ ok: false, code: "PERSISTENCE_FAILED" });
    expect(harnessed.campaigns.liveSessionOf(played.campaignId)).toBeUndefined();
    commitSave.mockRestore();
    const after = harnessed.persistence.campaigns.loadOwnedSave(played.campaignId, "acc_owner");
    if (after.status !== "loaded") throw new Error("Expected a stored save.");
    expect(after.record).toEqual(before.record);
    // The refused Continue left a save a later attempt can still migrate.
    expect((await harnessed.campaigns.continue("acc_owner", played.campaignId)).ok).toBe(true);
    harnessed.persistence.close();
  });

  it("refuses an unregistered previous pack and preserves its row", async () => {
    const harnessed = harness();
    const played = await playedToCombat(harnessed);
    rollBackToPreviousContent(harnessed, played);
    harnessed.database
      .prepare("UPDATE campaigns SET content_pack_version = ? WHERE campaign_id = ?")
      .run("0.2.0", played.campaignId);
    await harnessed.store.retire(played.sessionId, "previous build");
    const before = harnessed.persistence.campaigns.loadOwnedSave(played.campaignId, "acc_owner");

    const result = await harnessed.campaigns.continue("acc_owner", played.campaignId);

    // The stored metadata no longer agrees with its payload, which is corruption, not a
    // pack this build could migrate.
    expect(result.ok).toBe(false);
    expect(harnessed.persistence.campaigns.loadOwnedSave(played.campaignId, "acc_owner")).toEqual(before);
    harnessed.persistence.close();
  });
});