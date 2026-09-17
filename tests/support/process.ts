import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { TEST_ORIGIN } from "./network";

async function availablePort() {
  const reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const address = reservation.address();
  if (!address || typeof address === "string") throw new Error("No TCP port");
  await new Promise<void>((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));
  return address.port;
}

/** Each lifecycle owns a disk file and OS-assigned port. Readiness comes from the built server. */
export async function productProcess() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cardguild-process-contract-"));
  const databasePath = path.join(directory, "campaign.sqlite");
  const port = await availablePort();
  const origin = `http://127.0.0.1:${port}`;
  let child: ChildProcess | null = null;
  let log = "";
  async function stop(signal: NodeJS.Signals = "SIGTERM") {
    const current = child;
    if (!current) return;
    child = null;
    if (current.exitCode !== null || current.signalCode !== null) return;
    const ended = once(current, "exit");
    const limit = setTimeout(() => current.kill("SIGKILL"), 5_000);
    current.kill(signal);
    try { await ended; } finally { clearTimeout(limit); }
  }
  async function start() {
    if (child) throw new Error("Server is already started");
    log = "";
    const current = spawn(process.execPath, ["dist-server/main.js"], {
      cwd: process.cwd(), env: { ...process.env, CARDGUILD_HOST: "127.0.0.1", CARDGUILD_PORT: String(port),
        CARDGUILD_DB_PATH: databasePath, CARDGUILD_ALLOWED_ORIGINS: `${origin},${TEST_ORIGIN}`,
        CARDGUILD_COOKIE_SECURE: "false", CARDGUILD_ADVENTURE_SEED: "60" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child = current;
    try {
      await new Promise<void>((resolve, reject) => {
        const limit = setTimeout(() => { cleanup(); reject(new Error(`Built server readiness timed out: ${log}`)); }, 10_000);
        const cleanup = () => { clearTimeout(limit); current.off("exit", exited); current.off("error", failed); };
        const failed = (error: Error) => { cleanup(); reject(error); };
        const exited = () => { cleanup(); reject(new Error(`Built server exited before readiness: ${log}`)); };
        current.once("error", failed); current.once("exit", exited);
        current.stdout!.on("data", data => {
          log += String(data);
          if (log.includes(`listening at ${origin}`)) { cleanup(); resolve(); }
        });
        current.stderr!.on("data", data => { log += String(data); });
      });
      const health = await fetch(`${origin}/api/health`);
      if (!health.ok) throw new Error("Built server is not healthy");
    } catch (error) { await stop("SIGKILL"); throw error; }
  }
  return { directory, databasePath, origin, start, stop, get log() { return log; },
    async dispose() { try { await stop(); } finally { await rm(directory, { recursive: true, force: true }); } },
  };
}
