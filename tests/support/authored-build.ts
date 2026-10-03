import { cp, mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { CampaignProject } from "../../src/authoring/types";
import { applyCampaignProject } from "../../tools/campaign/repository";

/** A real edited production build in disposable storage, never the developer's DB or checkout. */
export async function authoredBuild(project: CampaignProject) {
  const source = process.cwd();
  const root = await mkdtemp(path.join(tmpdir(), "cardguild-authored-build-"));
  try {
    for (const file of ["src", "content", "presentation", "public", "index.html", "vite.config.ts", "tsconfig.json", "package.json"])
      await cp(path.join(source, file), path.join(root, file), { recursive: true });
    await mkdir(path.join(root, "art/source"), { recursive: true });
    await cp(path.join(source, "art/source/generation-plan.json"), path.join(root, "art/source/generation-plan.json"));
    await symlink(path.join(source, "node_modules"), path.join(root, "node_modules"), "dir");
    await applyCampaignProject(root, project);
    await promisify(execFile)("npm", ["run", "build", "--silent"], { cwd: root, timeout: 30_000, maxBuffer: 2_000_000 });
    return { root, dispose: () => rm(root, { recursive: true, force: true }) };
  } catch (error) { await rm(root, { recursive: true, force: true }); throw error; }
}
