import { afterEach, expect, it, vi } from "vitest";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { applyCampaignProject, CONTENT_FILES, planCampaignApply, readCampaignRepository } from "../../../tools/campaign/repository";
import { createCampaignProject } from "../../../src/authoring/default-project";

const failure = vi.hoisted(() => ({ destination: "" }));
vi.mock("node:fs/promises", async importOriginal => {
  const real = await importOriginal<typeof import("node:fs/promises")>();
  return { ...real, rename: async (from: string, to: string) => {
    if (to === failure.destination) { failure.destination = ""; throw new Error("INJECTED_RENAME_FAILURE"); }
    return real.rename(from, to);
  } };
});
const roots: string[] = [];
afterEach(async () => { failure.destination = ""; await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function repository(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "cardguild-authoring-")); roots.push(root);
  const files = [...CONTENT_FILES.map(name => `content/m7/${name}.json`), "content/m7/campaign.json", "src/scene/campaign-dialogue.json", "art/source/generation-plan.json", "presentation/m3/tilemaps.json",
    ...["terrain-elevations", "encounter-backgrounds", "campaign-objects", "asset-manifest"].map(name => `presentation/m3/${name}.json`)];
  for (const file of files) { await mkdir(path.dirname(path.join(root, file)), { recursive: true }); await copyFile(file, path.join(root, file)); }
  return root;
}
it("B-AUTHOR no-op preserves bytes; plan is read-only; apply updates only reviewed files and rejects stale reapply", async () => {
  const root = await repository();
  const { project } = await readCampaignRepository(root);
  expect(project.baseRevision).toBe(createCampaignProject().baseRevision);
  expect(await applyCampaignProject(root, project)).toEqual([]);
  const file = path.join(root, "content/m7/adventures.json");
  const before = await readFile(file, "utf8");
  const candidate = { ...project, content: { ...project.content, adventures: project.content.adventures.map(a => a.id === project.activeAdventureId
    ? { ...a, name: "편집한 캠페인", ending: { title: "새 엔딩", description: "돌아온 주민들" } } : a) } };
  const plan = await planCampaignApply(root, candidate);
  expect(plan.map(change => change.file)).toEqual(["content/m7/adventures.json"]);
  expect(await readFile(file, "utf8")).toBe(before);
  expect(await applyCampaignProject(root, candidate)).toEqual(["content/m7/adventures.json"]);
  const applied = await readCampaignRepository(root);
  expect(applied.project.content.adventures.find(a => a.id === project.activeAdventureId)!.name).toBe("편집한 캠페인");
  await expect(applyCampaignProject(root, project)).rejects.toThrow("STALE_PROJECT");
  expect((await readdir(root)).some(name => name.startsWith(".campaign-"))).toBe(false);
});
it("B-AUTHOR invalid projects and another active writer cannot replace campaign source files", async () => {
  const root = await repository();
  const { project } = await readCampaignRepository(root);
  const file = path.join(root, "content/m7/scenarios.json");
  const before = await readFile(file, "utf8");
  await expect(applyCampaignProject(root, { ...project, activeAdventureId: "missing" })).rejects.toThrow("activeAdventureId");
  expect(await readFile(file, "utf8")).toBe(before);
  const lock = path.join(root, ".campaign-authoring.lock");
  await writeFile(lock, "owned by another writer");
  await expect(applyCampaignProject(root, project)).rejects.toThrow("EEXIST");
  expect(await readFile(lock, "utf8")).toBe("owned by another writer");
  expect(await readFile(file, "utf8")).toBe(before);
});

it("B-AUTHOR applying a new encounter generates its runtime tilemap in the same write set", async () => {
  const root = await repository();
  const { project } = await readCampaignRepository(root);
  const original = project.content.scenarios.find(s => s.id === "encounter.willow-rescue")!;
  const id = "encounter.authoring-field";
  const candidate = { ...project, content: { ...project.content, scenarios: [...project.content.scenarios, { ...original, id }],
    adventures: project.content.adventures.map(a => a.id !== project.activeAdventureId ? a : { ...a,
      encounterIds: [...a.encounterIds, id], experienceAwards: [...a.experienceAwards, { afterEncounterId: id, amount: 125 }] }) },
    presentation: { ...project.presentation, elevations: { version: 1, maps: { ...project.presentation.elevations.maps,
      [id]: project.presentation.elevations.maps[original.id] } } } };
  const files = await applyCampaignProject(root, candidate);
  expect(files).toContain("presentation/m3/tilemaps.json");
  const tilemaps = JSON.parse(await readFile(path.join(root, "presentation/m3/tilemaps.json"), "utf8"));
  expect(tilemaps.maps[id]).toEqual(tilemaps.maps[original.id]);
  const after = await readCampaignRepository(root);
  expect(after.project.content.adventures.find(a => a.id === project.activeAdventureId)!.encounterIds.at(-1)).toBe(id);
  expect(after.project.presentation.elevations.maps[id]).toEqual(project.presentation.elevations.maps[original.id]);
});


it("B-AUTHOR a later file replacement failure restores already-written files and releases its lock", async () => {
  const root = await repository();
  const { project } = await readCampaignRepository(root);
  const beforeAdventure = await readFile(path.join(root, "content/m7/adventures.json"), "utf8");
  const beforeDialogue = await readFile(path.join(root, "src/scene/campaign-dialogue.json"), "utf8");
  const scene = project.dialogue.scenes[project.dialogue.bindings.welcome]!;
  const candidate = { ...project, content: { ...project.content,
    adventures: project.content.adventures.map(a => a.id === project.activeAdventureId ? { ...a, name: "실패 시 복원" } : a) },
    dialogue: { ...project.dialogue, scenes: { ...project.dialogue.scenes, [scene.id]: { ...scene, lines: [{ text: "변경한 대사" }] } } } };
  failure.destination = path.join(root, "src/scene/campaign-dialogue.json");
  await expect(applyCampaignProject(root, candidate)).rejects.toThrow("INJECTED_RENAME_FAILURE");
  expect(await readFile(path.join(root, "content/m7/adventures.json"), "utf8")).toBe(beforeAdventure);
  expect(await readFile(path.join(root, "src/scene/campaign-dialogue.json"), "utf8")).toBe(beforeDialogue);
  expect((await readdir(root)).some(name => name.startsWith(".campaign-"))).toBe(false);
});
