import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import process from "node:process";

function run(args: readonly string[]): ChildProcess {
  return spawn("npm", [...args], { stdio: "inherit", env: process.env });
}

// Hosting needs an account and there is no signup route, so the local database gets the
// fixed development accounts before anything can try to sign in. Seeding is idempotent
// and refuses to touch a production database, and it must finish before the server starts.
const seeded = spawnSync("npx", ["tsx", "tools/accounts/create-account.ts", "--seed-dev"], {
  stdio: "inherit",
  env: process.env,
});
if (seeded.status !== 0) throw new Error("Could not seed the development accounts.");

const server = run(["run", "dev:server"]);
const client = run(["run", "dev", "--", "--host", "127.0.0.1", "--port", "4173"]);
const children = [server, client];
let stopping = false;

function stop(signal: NodeJS.Signals = "SIGTERM"): void {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill(signal);
  }
}

process.once("SIGINT", () => stop("SIGINT"));
process.once("SIGTERM", () => stop("SIGTERM"));

const exitCode = await Promise.race(children.map((child) => new Promise<number>((resolve) => {
  child.once("exit", (code) => resolve(code ?? 1));
})));
stop();
process.exitCode = exitCode;
