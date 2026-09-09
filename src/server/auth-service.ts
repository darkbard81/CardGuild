import { createOpaqueId, createOpaqueToken, digestToken } from "./credentials";
import { hashPassword, verifyDecoyPassword, verifyPassword } from "./password";
import { USERNAME_TAKEN, type AccountRecord, type Persistence } from "./persistence";

export const INVALID_USERNAME = "INVALID_USERNAME";
export const INVALID_PASSWORD = "INVALID_PASSWORD";
export { USERNAME_TAKEN };

export const DEFAULT_AUTH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * ASCII only, so the accounts table's COLLATE NOCASE uniqueness is a total fold.
 * Widening this without adding a normalized column would let "Ä" and "ä" become two accounts.
 */
const USERNAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{2,31}$/;
const MIN_PASSWORD_LENGTH = 8;

export interface AuthSources {
  readonly now: () => number;
  readonly accountId: () => string;
  /** Only the token's randomness is injectable; its digest is always derived, never supplied. */
  readonly authToken: () => string;
}

export const productionAuthSources: AuthSources = {
  now: () => Date.now(),
  accountId: () => createOpaqueId("account"),
  authToken: createOpaqueToken,
};

/** What a caller may learn about the signed-in account. Never the hash, token or digest. */
export interface PublicAccount {
  readonly accountId: string;
  readonly username: string;
}

export interface AuthGrant {
  readonly token: string;
  readonly expiresAt: number;
  readonly account: PublicAccount;
}

export interface AuthService {
  createAccount(username: string, password: string): Promise<AccountRecord>;
  /** Null for both an unknown username and a wrong password, at the same cost. */
  login(username: string, password: string): Promise<AuthGrant | null>;
  authenticate(token: string | undefined): PublicAccount | null;
  logout(token: string | undefined): void;
}

export function publicAccount(account: AccountRecord): PublicAccount {
  return { accountId: account.accountId, username: account.username };
}

export function createAuthService(
  persistence: Persistence,
  ttlMs: number = DEFAULT_AUTH_TTL_MS,
  sources: AuthSources = productionAuthSources,
): AuthService {
  return {
    async createAccount(username, password) {
      if (!USERNAME_PATTERN.test(username)) throw new Error(INVALID_USERNAME);
      if (password.length < MIN_PASSWORD_LENGTH) throw new Error(INVALID_PASSWORD);
      return persistence.accounts.create({
        accountId: sources.accountId(),
        username,
        passwordHash: await hashPassword(password),
        createdAt: sources.now(),
      });
    },

    async login(username, password) {
      const account = persistence.accounts.findByUsername(username);
      if (!account) {
        // Spend the same work on an unknown username, so timing does not reveal the account set.
        await verifyDecoyPassword(password);
        return null;
      }
      if (!await verifyPassword(password, account.passwordHash)) return null;

      const token = sources.authToken();
      const createdAt = sources.now();
      const expiresAt = createdAt + ttlMs;
      persistence.authSessions.create({
        tokenDigest: digestToken(token), accountId: account.accountId, createdAt, expiresAt,
      });
      return { token, expiresAt, account: publicAccount(account) };
    },

    authenticate(token) {
      if (!token) return null;
      const now = sources.now();
      // Looking the digest up by primary key needs no constant-time compare: forging it is a preimage.
      const session = persistence.authSessions.findValid(digestToken(token), now);
      if (!session) {
        persistence.authSessions.deleteExpired(now);
        return null;
      }
      const account = persistence.accounts.findById(session.accountId);
      return account ? publicAccount(account) : null;
    },

    logout(token) {
      if (token) persistence.authSessions.delete(digestToken(token));
    },
  };
}
