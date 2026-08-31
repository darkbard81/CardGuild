import { spawn, type ChildProcess } from "node:child_process";
import process from "node:process";

function run(args: readonly string[]): ChildProcess {
  return spawn("npm", [...args], { stdio: "inherit", env: process.env });
}

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
