import { readFile, writeFile } from "node:fs/promises";
import { assertCampaignProject } from "../../src/authoring/project";
import { applyCampaignProject, planCampaignApply, readCampaignRepository } from "./repository";

async function main(): Promise<void> {
  const [command, file, ...extra] = process.argv.slice(2);
  if (extra.length || !["export", "check", "plan", "apply"].includes(command ?? "") || (command !== "check" && !file))
    throw new Error("Usage: npm run campaign -- export|check|plan|apply [project.json] (check without a file checks the repository)");
  const root = process.cwd();
  const { project, context } = await readCampaignRepository(root);
  if (command === "export") {
    assertCampaignProject(project, context);
    // Explicit export never silently overwrites an existing project draft.
    await writeFile(file!, `${JSON.stringify(project, null, 2)}\n`, { flag: "wx" });
    process.stdout.write(`Exported ${file} (${project.baseRevision})\n`);
    return;
  }
  const candidate: unknown = file ? JSON.parse(await readFile(file, "utf8")) : project;
  assertCampaignProject(candidate, context);
  if (command === "check") { process.stdout.write(`Campaign OK: ${candidate.activeAdventureId}\n`); return; }
  const files = command === "apply" ? await applyCampaignProject(root, candidate)
    : (await planCampaignApply(root, candidate)).map(change => change.file);
  process.stdout.write(`${command === "apply" ? "Applied" : "Would update"} ${files.length} files\n${files.join("\n")}\n`);
  if (command === "apply" && files.length) process.stdout.write("Tilemaps updated. Next: CI=true npm run check && CI=true npm run test:all (new image sources additionally require npm run assets:build)\n");
}
void main().catch(error => { process.stderr.write(`${String(error)}\n`); process.exitCode = 1; });
