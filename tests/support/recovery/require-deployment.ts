import { existsSync } from "node:fs";

/**
 * The deployment artefacts this suite restarts, checked once before any test starts.
 *
 * Recovery does not build. Building here would mean the suite verifies whatever it just
 * produced instead of what the caller meant to ship, and it would run a client and server
 * build that `npm run build` has already done in the same gate. So a missing artefact is a
 * failure with instructions, reported before Chromium starts rather than as a browser
 * timeout eighty seconds in.
 */
const REQUIRED = ["dist-server/main.js", "dist/index.html"] as const;

export default function requireDeployment(): void {
  const missing = REQUIRED.filter((file) => !existsSync(file));
  if (missing.length === 0) return;
  throw new Error(
    `Recovery runs the deployment build, and ${missing.join(" and ")} ${
      missing.length === 1 ? "is" : "are"
    } missing. Run \`npm run build\` first.`,
  );
}
