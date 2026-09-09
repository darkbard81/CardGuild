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

export interface CampaignService {
  create(accountId: string, name: string, displayName?: string): NewCampaign;
  list(accountId: string): readonly CampaignRecord[];
  /** Ownership is part of the lookup, so "not yours" and "not there" are the same answer. */
  findOwned(accountId: string, campaignId: string): CampaignRecord | undefined;
  ownershipOf(sessionId: string): CampaignOwnership | undefined;
}

export function createCampaignService(
  persistence: Persistence,
  store: SessionStore,
  sources: CampaignSources = productionCampaignSources,
): CampaignService {
  const ownership = new Map<string, CampaignOwnership>();

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
        credential = store.create(displayName);
      } catch (error) {
        // The caller is about to see a failure, so the campaign must not survive it. A row
        // with no session would still be listed and would still be M9-3's durable identity.
        persistence.campaigns.delete(campaign.campaignId, accountId);
        throw error;
      }
      ownership.set(credential.sessionId, {
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
  };
}
