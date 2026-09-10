import process from "node:process";

import {
  INVALID_PASSWORD,
  INVALID_USERNAME,
  PASSWORD_RULE,
  USERNAME_RULE,
  USERNAME_TAKEN,
  createAuthService,
} from "../../src/server/auth-service";
import { assertDevDatabase, resolveDatabasePath } from "../../src/server/database-path";
import { createSqlitePersistence } from "../../src/server/persistence";

/**
 * M9-2 deliberately has no HTTP register route: the server is publicly reachable, and an
 * open signup would let anyone create Campaign owners. Accounts are made here instead.
 *
 *   npm run account:create -- --username aerin      # password on stdin, never in argv
 *   npm run account:create -- --seed-dev            # fixed local accounts, development database only
 */

/** Passwords are public, so seeding is confined to the development database by path. */
export const DEV_ACCOUNTS = [
  { username: "dev-host-a", password: "dev-password-a" },
  { username: "dev-host-b", password: "dev-password-b" },
] as const;

function flagValue(argv: readonly string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
}

async function readPasswordFromStdin(): Promise<string> {
  if (process.stdin.isTTY) throw new Error("Pipe the password in, e.g. `printf %s \"$PW\" | npm run account:create -- --username aerin`.");
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk as Uint8Array));
  // Only a trailing newline is stripped: a password may legitimately contain spaces.
  return Buffer.concat(chunks).toString("utf8").replace(/\r?\n$/, "");
}

/** The service reports codes; the operator needs a sentence. */
function explain(error: unknown, username: string): string {
  const code = error instanceof Error ? error.message : String(error);
  if (code === USERNAME_TAKEN) return `Account "${username}" already exists.`;
  if (code === INVALID_USERNAME) return USERNAME_RULE;
  if (code === INVALID_PASSWORD) return PASSWORD_RULE;
  return code;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const databasePath = resolveDatabasePath();
  const seedDev = argv.includes("--seed-dev");
  // Checked before the file is opened, so a refused seed never even migrates the database
  // it was aimed at. Named by the database it may write to, not by an environment variable
  // that a deployment can simply not set.
  if (seedDev) assertDevDatabase(databasePath);

  const persistence = createSqlitePersistence(databasePath);
  const auth = createAuthService(persistence);

  try {
    if (seedDev) {
      for (const { username, password } of DEV_ACCOUNTS) {
        if (persistence.accounts.findByUsername(username)) {
          process.stdout.write(`Development account "${username}" already exists.\n`);
          continue;
        }
        await auth.createAccount(username, password);
        process.stdout.write(`Seeded development account "${username}".\n`);
      }
      return;
    }

    const username = flagValue(argv, "--username");
    if (!username) throw new Error("Usage: --username <name> (password on stdin) | --seed-dev");
    try {
      const account = await auth.createAccount(username, await readPasswordFromStdin());
      process.stdout.write(`Created account "${account.username}" (${account.accountId}) in ${databasePath}\n`);
    } catch (error) {
      throw new Error(explain(error, username), { cause: error });
    }
  } finally {
    persistence.close();
  }
}

try {
  await main();
} catch (error) {
  // A CLI misuse is not a crash: print the reason, not a stack the operator cannot act on.
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
