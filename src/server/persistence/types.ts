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
  /** M9-2 always reports false; M9-3 fills the snapshot columns behind this flag. */
  readonly hasSave: boolean;
  readonly createdAt: number;
  readonly updatedAt: number;
}

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
}

export interface Persistence {
  readonly accounts: AccountRepository;
  readonly authSessions: AuthSessionRepository;
  readonly campaigns: CampaignRepository;
  close(): void;
}
