import path from "node:path";
import process from "node:process";

export const DEFAULT_DATABASE_PATH = ".data/cardguild.sqlite";

/**
 * Where the durable Campaign database lives. The server and the account CLI must agree,
 * so both read it from here rather than each parsing the environment their own way.
 */
export function resolveDatabasePath(env: NodeJS.ProcessEnv = process.env): string {
  return path.resolve(process.cwd(), env["CARDGUILD_DB_PATH"] ?? DEFAULT_DATABASE_PATH);
}
