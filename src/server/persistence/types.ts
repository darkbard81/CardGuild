/**
 * Driver-agnostic persistence contract. Nothing here may mention SQL or a file path,
 * so M9-3 can add durable Campaign snapshots without the callers learning about SQLite.
 */

export const USERNAME_TAKEN = "USERNAME_TAKEN";

export interface AccountRecord {
  readonly accountId: string;
  readonly username: string;
  readonly passwordHash: string;
  readonly createdAt: number;
}

export interface AuthSessionRecord {
  readonly tokenDigest: string;
  readonly accountId: string;
  readonly createdAt: number;
  readonly expiresAt: number;
}

export interface CampaignRecord {
  readonly campaignId: string;
  readonly ownerAccountId: string;
  readonly name: string;
  readonly campaignRevision: number;
  /** True once the snapshot columns hold a gameplay save Continue can restore. */
  readonly hasSave: boolean;
  readonly createdAt: number;
  readonly updatedAt: number;
}

/** Driver-agnostic content identity, so persistence never imports the game types. */
export interface SaveContentIdentity {
  readonly packId: string;
  readonly packVersion: string;
  readonly fingerprint: string;
}

/**
 * A stored gameplay save. Kept apart from `CampaignRecord` so listing campaigns never
 * carries a full snapshot payload through the summary path.
 */
export interface CampaignSaveRecord {
  readonly campaignId: string;
  readonly ownerAccountId: string;
  readonly campaignRevision: number;
  readonly saveSchemaVersion: number;
  readonly contentIdentity: SaveContentIdentity;
  readonly snapshotJson: string;
  readonly snapshotHash: string;
  readonly updatedAt: number;
}

export interface CampaignSaveCommit {
  readonly campaignId: string;
  readonly ownerAccountId: string;
  /** Compare-and-swap guard. A stale live writer fails here instead of overwriting. */
  readonly expectedCampaignRevision: number;
  readonly saveSchemaVersion: number;
  readonly contentIdentity: SaveContentIdentity;
  readonly snapshotJson: string;
  readonly snapshotHash: string;
  readonly updatedAt: number;
}

/**
 * Why a save could not be read. `empty` and `partial` are distinct because a campaign that
 * has never been played is a normal answer, while half-written metadata is corruption.
 */
export type CampaignSaveLookup =
  | { readonly status: "not-found" }
  | { readonly status: "empty"; readonly campaignRevision: number }
  | { readonly status: "partial"; readonly campaignRevision: number }
  | { readonly status: "loaded"; readonly record: CampaignSaveRecord };

export type CampaignSaveCommitResult =
  | { readonly committed: true; readonly campaignRevision: number }
  | { readonly committed: false; readonly reason: "not-found" | "revision-conflict" };

export interface AccountRepository {
  /** Throws Error(USERNAME_TAKEN) when the username already exists, case-insensitively. */
  create(account: AccountRecord): AccountRecord;
  findById(accountId: string): AccountRecord | undefined;
  findByUsername(username: string): AccountRecord | undefined;
}

export interface AuthSessionRepository {
  create(session: AuthSessionRecord): AuthSessionRecord;
  /** Returns nothing for an unknown or expired digest, so expiry never needs a second check. */
  findValid(tokenDigest: string, now: number): AuthSessionRecord | undefined;
  delete(tokenDigest: string): void;
  deleteExpired(now: number): number;
}

export interface CampaignRepository {
  create(campaign: CampaignRecord): CampaignRecord;
  listByOwner(ownerAccountId: string): readonly CampaignRecord[];
  /** Ownership is part of the lookup, so a caller cannot forget to check it. */
  findOwned(campaignId: string, ownerAccountId: string): CampaignRecord | undefined;
  /** Undoes a create whose live session could not be opened. Ownership is part of the key. */
  delete(campaignId: string, ownerAccountId: string): boolean;
  /** Ownership is part of the lookup here too, so a stranger cannot read a save. */
  loadOwnedSave(campaignId: string, ownerAccountId: string): CampaignSaveLookup;
  /**
   * One atomic compare-and-swap: snapshot, hash, content identity, schema version,
   * `updatedAt` and the revision bump all land together or not at all.
   */
  commitSave(input: CampaignSaveCommit): CampaignSaveCommitResult;
}

export interface Persistence {
  readonly accounts: AccountRepository;
  readonly authSessions: AuthSessionRepository;
  readonly campaigns: CampaignRepository;
  close(): void;
}
