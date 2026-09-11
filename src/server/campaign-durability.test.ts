import { describe, expect, it } from "vitest";

import { hashSessionGameplayState, type SessionCoreState } from "../session";
import { CampaignWriterRetiredError, createCampaignDurability, type CampaignDurability } from "./campaign-durability";
import { createCampaignSave } from "./campaign-save";
import {
  FIXTURE_PARTY,
  fixtureBegun,
  fixtureDispatch,
  fixtureLobby,
  fixtureMidCombat,
} from "../../tests/fixtures/campaign-save";
import type { CampaignRepository, CampaignSaveCommit, CampaignSaveCommitResult } from "./persistence";

interface Harness {
  readonly durability: CampaignDurability;
  readonly commits: CampaignSaveCommit[];
  next(result: CampaignSaveCommitResult | Error): void;
}

function harness(campaignRevision = 0): Harness {
  const commits: CampaignSaveCommit[] = [];
  const queued: (CampaignSaveCommitResult | Error)[] = [];
  let revision = campaignRevision;
  const campaigns = {
    commitSave(input: CampaignSaveCommit): CampaignSaveCommitResult {
      commits.push(input);
      const forced = queued.shift();
      if (forced instanceof Error) throw forced;
      if (forced) return forced;
      if (input.expectedCampaignRevision !== revision) return { committed: false, reason: "revision-conflict" };
      revision += 1;
      return { committed: true, campaignRevision: revision };
    },
  } as unknown as CampaignRepository;
  return {
    durability: createCampaignDurability({
      campaigns,
      campaignId: "camp_1",
      ownerAccountId: "acc_owner",
      campaignRevision,
      now: () => 4_242,
    }),
    commits,
    next(result) {
      queued.push(result);
    },
  };
}

describe("campaign durability", () => {
  it("writes nothing for a transition that leaves the gameplay hash alone", async () => {
    const { durability, commits } = harness();
    const state = fixtureMidCombat();
    const claimed: SessionCoreState = {
      ...state,
      revision: state.revision + 1,
      seats: [...state.seats, { seat: 2, playerId: "player-guest", displayName: "Guest" }],
    };

    await durability.commitGameplayTransition(state, claimed);
    // Resume changes lifecycle only, which is deliberately outside the gameplay hash.
    await durability.commitGameplayTransition(state, { ...state, lifecycle: "resume-lobby" });

    expect(commits).toEqual([]);
    expect(durability.campaignRevision).toBe(0);
  });

  it("does not save a new campaign's lobby party, and makes Begin Adventure the first save", async () => {
    const { durability, commits } = harness();
    const lobby = fixtureLobby();
    const prepared = fixtureDispatch(lobby, lobby.hostPlayerId, {
      type: "set-party-composition",
      actorDefinitionIds: [...FIXTURE_PARTY],
    });

    // Party composition changes the hash, but there is no durable progress to keep yet.
    await durability.commitGameplayTransition(lobby, prepared);
    expect(commits).toEqual([]);

    const begun = fixtureDispatch(prepared, prepared.hostPlayerId, { type: "begin-adventure" });
    await durability.commitGameplayTransition(prepared, begun);

    expect(commits).toHaveLength(1);
    expect(durability.campaignRevision).toBe(1);
    expect(commits[0]).toMatchObject({
      campaignId: "camp_1",
      ownerAccountId: "acc_owner",
      expectedCampaignRevision: 0,
      saveSchemaVersion: 1,
      snapshotHash: hashSessionGameplayState(begun),
      updatedAt: 4_242,
    });
    expect(commits[0]?.snapshotJson).toBe(JSON.stringify(createCampaignSave(begun)));
  });

  it("advances one revision per committed gameplay transition", async () => {
    const { durability, commits } = harness();
    const begun = fixtureBegun();
    const started = fixtureDispatch(begun, begun.hostPlayerId, { type: "start-encounter" });

    await durability.commitGameplayTransition({ ...begun, adventure: null, combat: null }, begun);
    await durability.commitGameplayTransition(begun, started);

    expect(commits.map((entry) => entry.expectedCampaignRevision)).toEqual([0, 1]);
    expect(durability.commitCount).toBe(2);
    expect(durability.campaignRevision).toBe(2);
  });

  it("retires the writer when the compare-and-swap loses, and keeps its held revision", async () => {
    const { durability } = harness(7);
    const begun = fixtureBegun();
    const started = fixtureDispatch(begun, begun.hostPlayerId, { type: "start-encounter" });

    // The durable revision is 7 in this harness, so a writer holding 7 wins once.
    await durability.commitGameplayTransition(begun, started);
    expect(durability.campaignRevision).toBe(8);

    const stale = harness(7);
    stale.next({ committed: false, reason: "revision-conflict" });
    await expect(stale.durability.commitGameplayTransition(begun, started))
      .rejects.toBeInstanceOf(CampaignWriterRetiredError);
    // A failed write never advances the held revision: the database still holds 7.
    expect(stale.durability.campaignRevision).toBe(7);
    expect(stale.durability.commitCount).toBe(0);
  });

  it("retires the writer when the campaign it writes to is gone", async () => {
    const { durability, next } = harness();
    const begun = fixtureBegun();
    const started = fixtureDispatch(begun, begun.hostPlayerId, { type: "start-encounter" });
    next({ committed: false, reason: "not-found" });

    await expect(durability.commitGameplayTransition(begun, started)).rejects.toMatchObject({
      name: "CampaignWriterRetiredError",
      reason: "not-found",
    });
  });

  it("surfaces a store failure as itself, so the caller can treat it as retryable", async () => {
    const { durability, next } = harness();
    const begun = fixtureBegun();
    const started = fixtureDispatch(begun, begun.hostPlayerId, { type: "start-encounter" });
    const failure = new Error("database is locked");
    next(failure);

    await expect(durability.commitGameplayTransition(begun, started)).rejects.toBe(failure);
    expect(durability.campaignRevision).toBe(0);
  });
});
