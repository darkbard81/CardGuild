import path from "node:path";
import process from "node:process";

export const DEFAULT_DATABASE_PATH = ".data/cardguild.sqlite";

/**
 * Development and Playwright use their own file, kept apart from any deployed database.
 * The fixed development accounts have passwords committed to a public repository, so the
 * seeding path must never be able to reach a real one.
 */
export const DEV_DATABASE_PATH = ".data/cardguild.dev.sqlite";

/**
 * Where the durable Campaign database lives. The server and the account CLI must agree,
 * so both read it from here rather than each parsing the environment their own way.
 */
export function resolveDatabasePath(env: NodeJS.ProcessEnv = process.env): string {
  return path.resolve(process.cwd(), env["CARDGUILD_DB_PATH"] ?? DEFAULT_DATABASE_PATH);
}

export function isDevDatabase(databasePath: string): boolean {
  return path.resolve(databasePath) === path.resolve(process.cwd(), DEV_DATABASE_PATH);
}

/**
 * Guards development seeding by naming the one database it may touch, rather than by
 * asking what environment this is. An unset or mistyped NODE_ENV cannot open the gate,
 * and a deployment that forgets to set CARDGUILD_DB_PATH falls on the default — which
 * this refuses — instead of quietly accepting public credentials.
 */
export function assertDevDatabase(databasePath: string): void {
  if (isDevDatabase(databasePath)) return;
  throw new Error(
    `Development accounts may only be seeded into ${DEV_DATABASE_PATH}, not ${databasePath}. ` +
    "Set CARDGUILD_DB_PATH to the development database, or create the account with --username.",
  );
}
