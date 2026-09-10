import { DatabaseSync } from "node:sqlite";

import { createAuthService } from "../../../src/server/auth-service";
import { createPersistence, migrate, type Persistence } from "../../../src/server/persistence";
import type { SessionCredentialResponse } from "../../../src/server/session-store";

/**
 * Hosting requires an account since M9-2, and there is no signup route, so every network
 * test seeds its own private in-memory database and signs in over real HTTP.
 */
export const HOST_ACCOUNT = { username: "network-host", password: "network host password" };
export const OTHER_ACCOUNT = { username: "network-stranger", password: "network stranger password" };

export async function seededPersistence(
  accounts: readonly { readonly username: string; readonly password: string }[] = [HOST_ACCOUNT],
): Promise<Persistence> {
  const database = new DatabaseSync(":memory:");
  migrate(database);
  const persistence = createPersistence(database);
  const auth = createAuthService(persistence);
  for (const account of accounts) await auth.createAccount(account.username, account.password);
  return persistence;
}

/** Node's fetch keeps no cookie jar, so the auth cookie is carried explicitly. */
export async function signIn(origin: string, account = HOST_ACCOUNT): Promise<string> {
  const response = await fetch(new URL("/api/auth/login", origin), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(account),
  });
  if (!response.ok) throw new Error(`Sign in failed with ${response.status}.`);
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("Sign in returned no auth cookie.");
  return cookie;
}

/** Opening a campaign is also how a host opens its live session. */
export async function createHostSession(
  origin: string,
  cookie: string,
  displayName = "Host",
  name = "Goblin Trouble",
): Promise<SessionCredentialResponse> {
  const response = await fetch(new URL("/api/campaigns", origin), {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ name, displayName }),
  });
  if (response.status !== 201) throw new Error(`Creating a campaign failed with ${response.status}.`);
  return await response.json() as SessionCredentialResponse;
}

export async function hostSession(origin: string, displayName = "Host"): Promise<SessionCredentialResponse> {
  return createHostSession(origin, await signIn(origin), displayName);
}
