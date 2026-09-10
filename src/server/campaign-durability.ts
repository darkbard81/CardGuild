import { hashSessionGameplayState, type SessionCoreState } from "../session";
import { createCampaignSave } from "./campaign-save";
import type { CampaignRepository } from "./persistence";

/**
 * The boundary SessionHost commits through. It knows nothing about SQL: the coordinator
 * below turns a session transition into one durable compare-and-swap write.
 */
export interface SessionDurability {
  commitGameplayTransition(previous: SessionCoreState, candidate: SessionCoreState): Promise<void>;
}

/**
 * The durable authority refused this writer: either another live session already advanced
 * the campaign, or the campaign row is gone. This is terminal — the session must retire
 * rather than retry, because retrying is exactly how a split-brain writer overwrites.
 */
export class CampaignWriterRetiredError extends Error {
  public constructor(public readonly reason: "not-found" | "revision-conflict", message: string) {
    super(message);
    this.name = "CampaignWriterRetiredError";
  }
}

export interface CampaignDurabilityOptions {
  readonly campaigns: CampaignRepository;
  readonly campaignId: string;
  readonly ownerAccountId: string;
  /** The revision the save was loaded at. A fresh campaign starts at 0. */
  readonly campaignRevision: number;
  readonly now: () => number;
}

export interface CampaignDurability extends SessionDurability {
  /** The last successfully committed revision. Tests read it; nothing else needs it. */
  readonly campaignRevision: number;
  readonly commitCount: number;
}

export function createCampaignDurability(options: CampaignDurabilityOptions): CampaignDurability {
  let revision = options.campaignRevision;
  let commits = 0;

  return {
    get campaignRevision() {
      return revision;
    },
    get commitCount() {
      return commits;
    },
    // Declared async so a driver that throws synchronously still reaches the caller as a
    // rejected promise, which is the only failure shape SessionHost knows how to handle.
    async commitGameplayTransition(previous, candidate) {
      // Guest join, character claim, offline-guest removal, Resume and every presence or
      // control change leave the gameplay hash alone, so they never touch the database.
      if (hashSessionGameplayState(previous) === hashSessionGameplayState(candidate)) return;
      // A new campaign's lobby party editing is not yet durable progress: the first save is
      // the transition that produces an AdventureState.
      if (!candidate.adventure) return;

      const save = createCampaignSave(candidate);
      const result = options.campaigns.commitSave({
        campaignId: options.campaignId,
        ownerAccountId: options.ownerAccountId,
        expectedCampaignRevision: revision,
        saveSchemaVersion: save.saveSchemaVersion,
        contentIdentity: save.contentIdentity,
        snapshotJson: JSON.stringify(save),
        snapshotHash: hashSessionGameplayState(candidate),
        updatedAt: options.now(),
      });
      if (!result.committed) {
        throw new CampaignWriterRetiredError(
          result.reason,
          result.reason === "not-found"
            ? "The campaign this session writes to no longer exists."
            : "Another live session already advanced this campaign.",
        );
      }
      // Only a committed write moves the held revision, so a failure leaves the next
      // attempt comparing against the same generation the database still holds.
      revision = result.campaignRevision;
      commits += 1;
    },
  };
}
