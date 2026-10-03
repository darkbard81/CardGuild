import { expect, it } from "vitest";
import { createCampaignProject } from "../../../src/authoring/default-project";
import { duplicateCampaign } from "../../../src/authoring/duplicate";
import { compileContentPack, getContentIdentity } from "../../../src/content/compile-content";
import { validateProductionRelease } from "../../../tools/content/check-production-content";
import type { CampaignProject } from "../../../src/authoring/types";

async function check(project: CampaignProject) {
  const pack = compileContentPack(project.content);
  return validateProductionRelease({ pack, adventureId: project.activeAdventureId,
    adventure: pack.adventures[project.activeAdventureId]!, contentIdentity: getContentIdentity(pack) }, project.authoredAdventureIds);
}

it("B-AUTHOR release admits a registered, selected campaign while preserving Willowbrook tutorial and reward promises", async () => {
  const original = createCampaignProject();
  const base = original.content.adventures.find(a => a.id === original.activeAdventureId)!;
  const solo = { ...base, id: "adventure.solo", partySize: { min: 1 as const, max: 1 as const },
    encounterIds: base.encounterIds.slice(0, 1), rewards: [], experienceAwards: base.experienceAwards.slice(0, 1) };
  expect(await check({ ...original, activeAdventureId: solo.id, authoredAdventureIds: [solo.id],
    content: { ...original.content, adventures: [...original.content.adventures, solo] } })).toEqual([]);
  const copy = duplicateCampaign(original, original.activeAdventureId, "adventure.authored-release", "작성한 캠페인");
  const selected = { ...copy, activeAdventureId: "adventure.authored-release" };
  expect(await check(selected)).toEqual([]);
  const unregistered = await check({ ...selected, authoredAdventureIds: [] });
  expect(unregistered.some(i => i.code === "PRODUCTION_ADVENTURE_UNREGISTERED")).toBe(true);
  const broken = { ...selected, content: { ...selected.content, adventures: selected.content.adventures.map(a =>
    a.id === original.activeAdventureId ? { ...a, encounterIds: [...a.encounterIds].reverse() } : a) } };
  expect((await check(broken)).some(i => i.code === "TUTORIAL_PREFIX_MISMATCH")).toBe(true);
  const noExperience = { ...selected, content: { ...selected.content, adventures: selected.content.adventures.map(a =>
    a.id === selected.activeAdventureId ? { ...a, experienceAwards: a.experienceAwards.map(r => ({ ...r, amount: 0 })) } : a) } };
  expect((await check(noExperience)).some(i => i.code === "PRODUCTION_ENCOUNTER_WITHOUT_EXPERIENCE")).toBe(true);
});
