import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import path from "node:path";
import process from "node:process";

/**
 * The development bundle: a seeded database, the API server, and Vite.
 *
 * Every child is a direct CLI invocation from `node_modules/.bin`, not `npm run`. An `npm`
 * wrapper between this process and the real one swallows signals — the wrapper dies and the
 * server it started keeps the port — and a launcher that called back into a package script
 * would break the moment that script changed. It also runs no static checks: `npm run check`
 * owns those, and a developer restarting the server should not wait for a typecheck.
 */
function bin(name: string): string {
  return path.join(process.cwd(), "node_modules", ".bin", name);
}

const children: ChildProcess[] = [];
let stopping = false;

function stop(signal: NodeJS.Signals = "SIGTERM"): void {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill(signal);
  }
}

function start(label: string, command: string, args: readonly string[]): ChildProcess {
  const child = spawn(command, [...args], { stdio: "inherit", env: process.env });
  // A missing binary never reaches "exit", so without this the launcher would sit forever
  // waiting on a child that was never born.
  child.once("error", (error: Error) => {
    process.stderr.write(`Could not start ${label}: ${error.message}\n`);
    process.exitCode = 1;
    stop();
  });
  children.push(child);
  return child;
}

// Hosting needs an account, so the local database gets the fixed development accounts before
// anything can try to sign in. Seeding is idempotent and refuses to touch a production
// database, and it must finish before the server starts.
const seeded = spawnSync(bin("tsx"), ["tools/accounts/create-account.ts", "--seed-dev"], {
  stdio: "inherit",
  env: process.env,
});
if (seeded.status !== 0) throw new Error("Could not seed the development accounts.");

start("the API server", bin("tsx"), ["watch", "src/server/main.ts"]);
start("Vite", bin("vite"), ["--host", "127.0.0.1", "--port", "4173"]);

function exited(child: ChildProcess): Promise<number> {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode);
  return new Promise<number>((resolve) => child.once("exit", (code) => resolve(code ?? 1)));
}

process.once("SIGINT", () => stop("SIGINT"));
process.once("SIGTERM", () => stop("SIGTERM"));

// Either half going down takes the bundle with it: a client with no server behind it looks
// like a product bug. Then wait for the rest to actually be gone, so the ports are free by
// the time this process exits.
const first = await Promise.race(children.map(exited));
stop();
await Promise.all(children.map(exited));
process.exitCode = process.exitCode ?? first;
