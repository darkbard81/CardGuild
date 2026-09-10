import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import process from "node:process";

/**
 * Which durable transition a fault is aimed at.
 *
 * "the third commit" was enough while every save looked alike, but M9-4 made the
 * interesting boundaries semantic: a Level-Up, a reward grant, a content migration. Naming
 * the transition instead of counting writes keeps a test readable and stops it silently
 * aiming at a different write when the setup path gains or loses one.
 */
export type FaultTarget =
  | "any"
  | "combat-command"
  | "ai-command"
  | "encounter-complete"
  | "level-up"
  | "adventure-complete"
  | "reward"
  | "migration";

export interface FaultSpec {
  /** Relative to the durable write: `after` is the window where the client sees no ACK. */
  readonly when: "before" | "after";
  readonly target: FaultTarget;
  /** 1-based ordinal among commits that match `target`, counted from arming. */
  readonly nth?: number;
}

/** What the child wrote out synchronously in the instant before it killed itself. */
export interface FaultMarker {
  readonly when: "before" | "after";
  readonly target: FaultTarget;
  readonly matched: number;
  readonly campaignRevision: number;
}

export interface FaultChild {
  readonly origin: string;
  readonly process: ChildProcess;
  readonly output: () => string;
  readonly exited: Promise<{ readonly code: number | null; readonly signal: NodeJS.Signals | null }>;
  /** Arm the fault and wait for the child to confirm; nothing faults before this resolves. */
  arm(spec: FaultSpec): Promise<void>;
  /** The marker the child left, or null if it never faulted. */
  marker(): FaultMarker | null;
  /** Ask for a graceful shutdown and wait for the process to go. */
  stop(signals?: readonly NodeJS.Signals[]): Promise<{ readonly code: number | null; readonly signal: NodeJS.Signals | null }>;
}

export interface FaultChildOptions {
  readonly databasePath: string;
  readonly markerPath: string;
  readonly origin: string;
  readonly account?: { readonly username: string; readonly password: string };
  readonly adventureSeed?: number;
}

/**
 * Start the crash-testable server in its own process.
 *
 * The crash contract is that the process dies, so it cannot be exercised in-process: the
 * child owns the real file database, and the parent reopens it afterwards to see what
 * survived.
 */
export function startFaultServer(options: FaultChildOptions): Promise<FaultChild> {
  const child = spawn(process.execPath, ["--import", "tsx", "tests/network/fault-server.ts"], {
    cwd: process.cwd(),
    stdio: ["pipe", "pipe", "pipe", "ipc"],
    env: {
      ...process.env,
      CARDGUILD_TEST_DB: options.databasePath,
      CARDGUILD_TEST_MARKER: options.markerPath,
      CARDGUILD_TEST_ORIGIN: options.origin,
      CARDGUILD_TEST_SEED: String(options.adventureSeed ?? 1),
      ...(options.account ? { CARDGUILD_TEST_ACCOUNT: `${options.account.username}:${options.account.password}` } : {}),
    },
  });
  let output = "";
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => { output += chunk; });
  child.stderr?.on("data", (chunk: string) => { output += chunk; });
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });

  function marker(): FaultMarker | null {
    try {
      return JSON.parse(readFileSync(options.markerPath, "utf8")) as FaultMarker;
    } catch {
      return null;
    }
  }

  return new Promise<FaultChild>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Child server never became ready: " + output)), 60_000);
    const check = (): void => {
      const match = /READY (\S+)/.exec(output);
      if (!match?.[1]) return;
      clearTimeout(timeout);
      child.stdout?.off("data", check);
      rmSync(options.markerPath, { force: true });
      resolve({
        origin: match[1],
        process: child,
        output: () => output,
        exited,
        marker,
        arm: (spec) => new Promise<void>((armed, failed) => {
          const armingTimeout = setTimeout(() => failed(new Error("Child never confirmed the fault: " + output)), 15_000);
          const listener = (message: unknown): void => {
            if ((message as { readonly type?: string } | null)?.type !== "armed") return;
            clearTimeout(armingTimeout);
            child.off("message", listener);
            armed();
          };
          child.on("message", listener);
          child.send({ type: "arm", ...spec });
        }),
        stop: async (signals = ["SIGTERM"]) => {
          for (const signal of signals) if (child.exitCode === null) child.kill(signal);
          return await exited;
        },
      });
    };
    child.stdout?.on("data", check);
    child.once("exit", () => {
      clearTimeout(timeout);
      reject(new Error("Child server exited before listening: " + output));
    });
  });
}
