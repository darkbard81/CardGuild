import { buildPresentationTilemaps, type TilemapBuildStyle } from "../../src/presentation/build-tilemaps";
import { mkdir, mkdtemp, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { campaignRevision, assertCampaignProject, type CampaignValidationContext } from "../../src/authoring/project";
import type { CampaignProject } from "../../src/authoring/types";
import type { ContentPackSource } from "../../src/content/content-types";
import { stableSerialize } from "../../src/game/determinism";
import { SCENE_CATALOG } from "../../src/scene/face-catalog";

export const CONTENT_FILES = ["manifest", "traits", "ancestries", "classes", "conditions", "actions", "cards",
  "equipment", "actors", "scenarios", "adventures", "companions", "creationPresets"] as const;
const AUXILIARY_FILES = {
  campaign: "content/m7/campaign.json", dialogue: "src/scene/campaign-dialogue.json",
  elevations: "presentation/m3/terrain-elevations.json", backgrounds: "presentation/m3/encounter-backgrounds.json",
  objects: "presentation/m3/campaign-objects.json",
};
async function json(root: string, file: string): Promise<unknown> { return JSON.parse(await readFile(path.join(root, file), "utf8")); }
export async function readCampaignRepository(root: string): Promise<{ project: CampaignProject; context: CampaignValidationContext }> {
  const content = Object.fromEntries(await Promise.all(CONTENT_FILES.map(async key => [key, await json(root, `content/m7/${key}.json`)]))) as unknown as ContentPackSource;
  const [campaign, dialogue, elevations, backgrounds, objects, manifest] = await Promise.all([
    ...Object.values(AUXILIARY_FILES).map(file => json(root, file)), json(root, "presentation/m3/asset-manifest.json"),
  ]);
  const generation = await json(root, "art/source/generation-plan.json") as { presentation: TilemapBuildStyle };
  const body = { version: 1 as const, activeAdventureId: (campaign as { adventureId: string }).adventureId,
    content, dialogue, presentation: { elevations, backgrounds, objects, scenery: generation.presentation.scenery ?? [] } } as Omit<CampaignProject, "baseRevision">;
  const project = { ...body, baseRevision: campaignRevision(body) };
  const context = { sceneCatalog: SCENE_CATALOG, objectVisuals: generation.presentation.objectVisuals, assets: (manifest as CampaignValidationContext).assets };
  return { project, context };
}
export interface CampaignFileChange { readonly file: string; readonly before: string; readonly after: string }
export async function planCampaignApply(root: string, candidate: unknown): Promise<readonly CampaignFileChange[]> {
  const { project: current, context } = await readCampaignRepository(root);
  assertCampaignProject(candidate, context);
  if (candidate.baseRevision !== current.baseRevision) throw new Error("STALE_PROJECT: 저장소가 바뀌었습니다. 다시 내보낸 프로젝트에 변경을 병합하세요.");
  const outputs: Record<string, unknown> = Object.fromEntries(CONTENT_FILES.map(key => [`content/m7/${key}.json`, candidate.content[key] ?? []]));
  Object.assign(outputs, {
    [AUXILIARY_FILES.campaign]: { adventureId: candidate.activeAdventureId },
    [AUXILIARY_FILES.dialogue]: candidate.dialogue,
    [AUXILIARY_FILES.elevations]: candidate.presentation.elevations,
    [AUXILIARY_FILES.backgrounds]: candidate.presentation.backgrounds,
    [AUXILIARY_FILES.objects]: candidate.presentation.objects,
  });
  const generation = await json(root, "art/source/generation-plan.json") as { presentation: TilemapBuildStyle };
  const style = { ...generation.presentation, scenery: candidate.presentation.scenery };
  outputs["art/source/generation-plan.json"] = { ...generation, presentation: style };
  outputs["presentation/m3/tilemaps.json"] = buildPresentationTilemaps(candidate.content.scenarios, style);
  const changes: CampaignFileChange[] = [];
  for (const [file, value] of Object.entries(outputs)) {
    const before = await readFile(path.join(root, file), "utf8");
    if (stableSerialize(JSON.parse(before)) !== stableSerialize(value))
      changes.push({ file, before, after: `${JSON.stringify(value, null, 2)}\n` });
  }
  return changes;
}
/** Cooperative writer lock, optimistic source revision, preflight, and rollback on I/O failure.
 * No dev DB, save file, generated atlas, or caller-supplied output path is part of this write set.
 */
export async function applyCampaignProject(root: string, candidate: unknown): Promise<readonly string[]> {
  const lockPath = path.join(root, ".campaign-authoring.lock");
  const lock = await open(lockPath, "wx");
  let stage: string | undefined;
  const written: CampaignFileChange[] = [];
  try {
    const changes = await planCampaignApply(root, candidate);
    stage = await mkdtemp(path.join(root, ".campaign-stage-"));
    for (const change of changes) {
      const file = path.join(stage, change.file);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, change.after);
    }
    // Recheck every file before starting replacements, including unchanged source files.
    const current = await readCampaignRepository(root);
    if ((candidate as CampaignProject).baseRevision !== current.project.baseRevision) throw new Error("STALE_PROJECT: 반영 직전에 저장소가 바뀌었습니다.");
    for (const change of changes) {
      if (await readFile(path.join(root, change.file), "utf8") !== change.before) throw new Error(`CONCURRENT_EDIT: ${change.file}`);
      await rename(path.join(stage, change.file), path.join(root, change.file));
      written.push(change);
    }
    return changes.map(change => change.file);
  } catch (error) {
    for (const change of written.reverse()) {
      if (await readFile(path.join(root, change.file), "utf8") !== change.after)
        throw new Error(`ROLLBACK_CONFLICT: ${change.file}. 외부 수정은 보존했습니다. 원래 오류: ${String(error)}`, { cause: error });
      const restore = path.join(stage!, change.file);
      await writeFile(restore, change.before);
      await rename(restore, path.join(root, change.file));
    }
    throw error;
  } finally {
    if (stage) await rm(stage, { recursive: true, force: true });
    await lock.close();
    await rm(lockPath);
  }
}
