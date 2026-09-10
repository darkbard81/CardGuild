import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

/**
 * The deployed server, run the way a deployment runs it.
 *
 * This suite is about restarting the real thing: `dist-server/main.js` serving the built
 * client out of `dist/`, against a file database it reopens. Nothing here imports the
 * server's own modules — a recovery that only works when the test process is holding the
 * pieces together is not a recovery.
 */
export interface RecoveryDeployment {
  readonly origin: string;
  readonly databasePath: string;
  readonly account: { readonly username: string; readonly password: string };
  /** Start (or restart) the server on the same port and the same database file. */
  start(): Promise<void>;
  /** Ask for a graceful shutdown and wait for the process to exit. */
  stop(): Promise<{ readonly code: number | null; readonly signal: NodeJS.Signals | null }>;
  /** Kill the process outright, with no chance to close the database. */
  kill(): Promise<{ readonly code: number | null; readonly signal: NodeJS.Signals | null }>;
  readonly running: () => boolean;
  readonly output: () => string;
  dispose(): Promise<void>;
}

async function freePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (!address || typeof address === "string") {
        probe.close();
        reject(new Error("Could not reserve a port."));
        return;
      }
      const { port } = address;
      probe.close(() => resolve(port));
    });
  });
}

export async function startDeployment(label: string): Promise<RecoveryDeployment> {
  const directory = mkdtempSync(path.join(tmpdir(), `cardguild-recovery-${label}-`));
  const databasePath = path.join(directory, "campaigns.sqlite");
  const port = await freePort();
  const origin = `http://127.0.0.1:${String(port)}`;
  const account = { username: `recovery-${label}`, password: "recovery host password" };

  // The real operator path for making an owner, including its refusal to seed shared
  // development credentials into a database that is not the development one.
  const created = spawnSync(
    "npx",
    ["tsx", "tools/accounts/create-account.ts", "--username", account.username],
    { cwd: process.cwd(), env: { ...process.env, CARDGUILD_DB_PATH: databasePath }, input: account.password, encoding: "utf8" },
  );
  if (created.status !== 0) {
    throw new Error(`Could not create the recovery account: ${created.stdout}${created.stderr}`);
  }

  let child: ChildProcessWithoutNullStreams | null = null;
  let output = "";
  let exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }> = Promise.resolve({ code: 0, signal: null });

  async function start(): Promise<void> {
    if (child) throw new Error("The deployment is already running.");
    const started = spawn(process.execPath, ["dist-server/main.js"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        CARDGUILD_PORT: String(port),
        CARDGUILD_HOST: "127.0.0.1",
        CARDGUILD_DB_PATH: databasePath,
        CARDGUILD_ALLOWED_ORIGINS: origin,
        // Fixed, so a recovered campaign is comparable across restarts.
        CARDGUILD_ADVENTURE_SEED: "1",
      },
    });
    child = started;
    started.stdout.setEncoding("utf8");
    started.stderr.setEncoding("utf8");
    started.stdout.on("data", (chunk: string) => { output += chunk; });
    started.stderr.on("data", (chunk: string) => { output += chunk; });
    exited = new Promise((resolve) => started.once("exit", (code, signal) => {
      if (child === started) child = null;
      resolve({ code, signal });
    }));
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("The deployment never listened: " + output)), 60_000);
      const check = (): void => {
        if (!output.includes(`listening at ${origin}`)) return;
        clearTimeout(timeout);
        started.stdout.off("data", check);
        resolve();
      };
      started.stdout.on("data", check);
      started.once("exit", () => {
        clearTimeout(timeout);
        reject(new Error("The deployment exited before listening: " + output));
      });
    });
  }

  async function signal(kind: NodeJS.Signals): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
    const running = child;
    if (!running) return await exited;
    running.kill(kind);
    return await exited;
  }

  await start();
  return {
    origin,
    databasePath,
    account,
    start,
    stop: () => signal("SIGTERM"),
    kill: () => signal("SIGKILL"),
    running: () => child !== null,
    output: () => output,
    dispose: async () => {
      await signal("SIGKILL");
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
