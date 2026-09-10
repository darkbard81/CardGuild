import { createCampaignDurability, type SessionDurability } from "./campaign-durability";
import { CampaignSaveError, restoreCampaignSave, type CampaignRestoreResult } from "./campaign-save";
import { createOpaqueId } from "./credentials";
import type { CampaignRecord, Persistence } from "./persistence";
import type { SessionCredentialResponse, SessionStore } from "./session-store";

export const INVALID_CAMPAIGN_NAME = "INVALID_CAMPAIGN_NAME";

const MAX_CAMPAIGN_NAME_LENGTH = 60;

export interface CampaignSources {
  readonly now: () => number;
  readonly campaignId: () => string;
}

export const productionCampaignSources: CampaignSources = {
  now: () => Date.now(),
  campaignId: () => createOpaqueId("campaign"),
};

/**
 * Which account owns the live session a Guest may be sitting in. This is deliberately kept
 * beside the sessions rather than inside SessionCoreState: ownership is not gameplay, and
 * anything in SessionCoreState would land in the gameplay hash.
 */
export interface CampaignOwnership {
  readonly campaignId: string;
  readonly ownerAccountId: string;
}

export interface NewCampaign {
  readonly campaign: CampaignRecord;
  readonly credential: SessionCredentialResponse;
}

export type CampaignContinueFailureCode =
  | "CAMPAIGN_NOT_FOUND"
  | "SAVE_NOT_FOUND"
  | "SAVE_CORRUPT"
  | "SAVE_SCHEMA_UNSUPPORTED"
  | "SAVE_CONTENT_MISMATCH"
  | "PERSISTENCE_FAILED";

export type CampaignContinueResult =
  | { readonly ok: true; readonly campaign: CampaignRecord; readonly credential: SessionCredentialResponse }
  | { readonly ok: false; readonly code: CampaignContinueFailureCode; readonly message: string };

export interface CampaignService {
  create(accountId: string, name: string, displayName?: string): NewCampaign;
  list(accountId: string): readonly CampaignRecord[];
  /** Ownership is part of the lookup, so "not yours" and "not there" are the same answer. */
  findOwned(accountId: string, campaignId: string): CampaignRecord | undefined;
  ownershipOf(sessionId: string): CampaignOwnership | undefined;
  /** Which live session, if any, is currently the writer for this campaign. */
  liveSessionOf(campaignId: string): string | undefined;
  /** Retire whatever live session a campaign has and open a fresh one from its save. */
  continue(accountId: string, campaignId: string, displayName?: string): Promise<CampaignContinueResult>;
}

export function createCampaignService(
  persistence: Persistence,
  store: SessionStore,
  sources: CampaignSources = productionCampaignSources,
): CampaignService {
  const ownership = new Map<string, CampaignOwnership>();
  const liveSessionByCampaignId = new Map<string, string>();
  const continueQueues = new Map<string, Promise<unknown>>();

  function forget(sessionId: string): void {
    const owned = ownership.get(sessionId);
    ownership.delete(sessionId);
    // Only clear the campaign's writer if it is still this session. A slow cleanup must not
    // erase the mapping a newer Continue has already installed.
    if (owned && liveSessionByCampaignId.get(owned.campaignId) === sessionId) {
      liveSessionByCampaignId.delete(owned.campaignId);
    }
  }

  function remember(sessionId: string, owned: CampaignOwnership): void {
    ownership.set(sessionId, owned);
    liveSessionByCampaignId.set(owned.campaignId, sessionId);
  }

  // A session that retires itself — an AI step whose durable write failed, say — must stop
  // being the campaign's writer even though nobody called Continue.
  store.onRetired((sessionId) => forget(sessionId));

  function durabilityFor(
    campaignId: string,
    ownerAccountId: string,
    campaignRevision: number,
  ): SessionDurability {
    return createCampaignDurability({
      campaigns: persistence.campaigns,
      campaignId,
      ownerAccountId,
      campaignRevision,
      now: sources.now,
    });
  }

  /** Continue is serialized per campaign, so two concurrent calls cannot both become writer. */
  function serialize<T>(campaignId: string, operation: () => Promise<T>): Promise<T> {
    const previous = continueQueues.get(campaignId) ?? Promise.resolve();
    const next = previous.then(operation, operation);
    continueQueues.set(campaignId, next.then(() => undefined, () => undefined));
    return next;
  }

  function loadSave(campaignId: string, accountId: string):
    | { readonly ok: true; readonly restored: CampaignRestoreResult; readonly campaignRevision: number }
    | { readonly ok: false; readonly code: CampaignContinueFailureCode; readonly message: string } {
    const lookup = persistence.campaigns.loadOwnedSave(campaignId, accountId);
    if (lookup.status === "not-found") {
      return { ok: false, code: "CAMPAIGN_NOT_FOUND", message: "Campaign was not found." };
    }
    if (lookup.status === "empty") {
      return { ok: false, code: "SAVE_NOT_FOUND", message: "This campaign has no saved progress to continue yet." };
    }
    if (lookup.status === "partial") {
      return { ok: false, code: "SAVE_CORRUPT", message: "This campaign's stored save metadata is incomplete." };
    }
    try {
      return {
        ok: true,
        restored: restoreCampaignSave(lookup.record, store.authorityContext),
        campaignRevision: lookup.record.campaignRevision,
      };
    } catch (error) {
      if (error instanceof CampaignSaveError) return { ok: false, code: error.code, message: error.message };
      throw error;
    }
  }

  return {
    create(accountId, name, displayName) {
      const trimmed = name.trim();
      if (!trimmed || trimmed.length > MAX_CAMPAIGN_NAME_LENGTH) throw new Error(INVALID_CAMPAIGN_NAME);

      // The durable row goes first: a persistence failure then leaves no orphan live session.
      // The opposite order leaks a session on every failed write.
      const createdAt = sources.now();
      const campaign = persistence.campaigns.create({
        campaignId: sources.campaignId(),
        ownerAccountId: accountId,
        name: trimmed,
        campaignRevision: 0,
        hasSave: false,
        createdAt,
        updatedAt: createdAt,
      });
      let credential;
      try {
        credential = store.create(
          displayName,
          durabilityFor(campaign.campaignId, accountId, campaign.campaignRevision),
        );
      } catch (error) {
        // The caller is about to see a failure, so the campaign must not survive it. A row
        // with no session would still be listed and would still be M9-3's durable identity.
        persistence.campaigns.delete(campaign.campaignId, accountId);
        throw error;
      }
      remember(credential.sessionId, {
        campaignId: campaign.campaignId,
        ownerAccountId: accountId,
      });
      return { campaign, credential };
    },

    list(accountId) {
      return persistence.campaigns.listByOwner(accountId);
    },

    findOwned(accountId, campaignId) {
      return persistence.campaigns.findOwned(campaignId, accountId);
    },

    ownershipOf(sessionId) {
      return ownership.get(sessionId);
    },

    liveSessionOf(campaignId) {
      return liveSessionByCampaignId.get(campaignId);
    },

    continue(accountId, campaignId, displayName) {
      return serialize(campaignId, async (): Promise<CampaignContinueResult> => {
        const campaign = persistence.campaigns.findOwned(campaignId, accountId);
        // Another account's campaign is indistinguishable from one that does not exist.
        if (!campaign) return { ok: false, code: "CAMPAIGN_NOT_FOUND", message: "Campaign was not found." };

        // Validate first. An unsupported or corrupt save must not cost the host the live
        // session they may still be playing in.
        const preflight = loadSave(campaignId, accountId);
        if (!preflight.ok) return preflight;

        const previousSessionId = liveSessionByCampaignId.get(campaignId);
        if (previousSessionId) {
          await store.retire(previousSessionId, "This campaign was continued in a new session.");
          forget(previousSessionId);
        }

        // Read again after the barrier: the retired host's queue may have committed one more
        // gameplay transition between the preflight and its own retirement, and the save it
        // wrote may need a different migration than the one the preflight computed.
        const loaded = loadSave(campaignId, accountId);
        if (!loaded.ok) return loaded;

        // A migrated save becomes durable before any live session is published against it.
        // The CAS is the same one gameplay commits through, so a stale writer that slipped
        // past the barrier loses here instead of overwriting the migration.
        let campaignRevision = loaded.campaignRevision;
        const migration = loaded.restored.migration;
        if (migration) {
          const committed = persistence.campaigns.commitSave({
            campaignId,
            ownerAccountId: accountId,
            expectedCampaignRevision: campaignRevision,
            saveSchemaVersion: migration.save.saveSchemaVersion,
            contentIdentity: migration.save.contentIdentity,
            snapshotJson: JSON.stringify(migration.save),
            snapshotHash: migration.snapshotHash,
            updatedAt: sources.now(),
          });
          if (!committed.committed) {
            return {
              ok: false,
              code: "PERSISTENCE_FAILED",
              message: committed.reason === "not-found"
                ? "This campaign no longer exists."
                : "Another live session advanced this campaign while it was being migrated.",
            };
          }
          campaignRevision = committed.campaignRevision;
        }

        let credential: SessionCredentialResponse;
        try {
          credential = store.restore(loaded.restored.projection, {
            displayName,
            durability: durabilityFor(campaignId, accountId, campaignRevision),
          });
        } catch (error) {
          return {
            ok: false,
            code: "PERSISTENCE_FAILED",
            message: error instanceof Error
              ? "Opening a live session for this campaign failed: " + error.message
              : "Opening a live session for this campaign failed.",
          };
        }
        remember(credential.sessionId, { campaignId, ownerAccountId: accountId });
        return { ok: true, campaign, credential };
      });
    },
  };
}
