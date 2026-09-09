import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";

import { PRODUCTION_CONTENT } from "../content";
import { hashSessionGameplayState } from "../session";
import { INVALID_CAMPAIGN_NAME, createCampaignService, type CampaignService } from "./campaign-service";
import { digestReconnectToken } from "./credentials";
import { createPersistence, migrate, type Persistence } from "./persistence";
import { SessionStore } from "./session-store";

interface Harness {
  readonly campaigns: CampaignService;
  readonly persistence: Persistence;
  readonly store: SessionStore;
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
