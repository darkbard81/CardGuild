import { expect, it } from "vitest";
import { createCampaignProject, CAMPAIGN_VALIDATION_CONTEXT as context } from "../../src/authoring/default-project";
import { campaignRevision, validateCampaignProject } from "../../src/authoring/project";
import { placeCampaignObject, resizeCampaignMap } from "../../src/authoring/edit-map";
import { campaignObjectVisual } from "../../src/presentation/campaign-objects";
import { createCombat } from "../../src/game";
import { play } from "../support/combat";
import { compileContentPack, getContentIdentity } from "../../src/content/compile-content";
import { previewCampaignEncounter } from "../../src/authoring/preview";
import { duplicateCampaign } from "../../src/authoring/duplicate";

it("G-AUTHOR production export round-trips maps, dialogues, rewards, presentation and stable revision", () => {
  const project = createCampaignProject();
  const copy = JSON.parse(JSON.stringify(project));
  expect(validateCampaignProject(copy, context)).toEqual([]);
  expect(campaignRevision(copy)).toBe(project.baseRevision);
  expect(compileContentPack(copy.content).fingerprint).toBe(compileContentPack(project.content).fingerprint);
  const changed = { ...copy, activeAdventureId: "adventure.goblin-trouble" };
  expect(campaignRevision(changed)).not.toBe(project.baseRevision);
  expect(validateCampaignProject(changed, context)).toEqual([]);
});

it("G-AUTHOR rejects malformed documents before semantics and reports dangling dialogue, reward and height references", () => {
  for (const value of [null, [], { version: 2 }, { ...createCampaignProject(), content: {} }])
    expect(validateCampaignProject(value, context).length).toBeGreaterThan(0);
  const project = createCampaignProject();
  const bad = { ...project, activeAdventureId: "missing", dialogue: { ...project.dialogue,
    bindings: { ...project.dialogue.bindings, welcome: "missing" } }, presentation: { ...project.presentation,
    elevations: { version: 1, maps: { missing: [0] } } }, content: { ...project.content,
    adventures: project.content.adventures.map(a => ({ ...a, rewards: [...a.rewards,
      { id: "bad-reward", afterEncounterId: a.encounterIds[0], choices: [{ kind: "card", definitionId: "missing-card" }] }] })) } };
  const issues = validateCampaignProject(bad, context);
  expect(issues.some(i => i.path === "/activeAdventureId")).toBe(true);
  expect(issues.some(i => i.path.startsWith("/dialogue/"))).toBe(true);
  expect(issues.some(i => i.path.startsWith("/presentation/elevations/"))).toBe(true);
  expect(issues.some(i => i.message.includes("missing-card"))).toBe(true);
  const missingCell = { ...project, content: { ...project.content, scenarios: project.content.scenarios.map(s =>
    s.id !== "encounter.guild-practice" ? s : { ...s, map: { ...s.map, tiles: s.map.tiles.filter(t => t.position.x !== 1 || t.position.y !== 0) } }) } };
  // A sparse rules map is legal, but cannot be edited/rendered as a rectangle.
  expect(() => compileContentPack(missingCell.content)).not.toThrow();
  expect(validateCampaignProject(missingCell, context)).toContainEqual({
    path: "/content/scenarios/encounter.guild-practice/map/tiles", message: "편집 맵은 모든 좌표의 타일을 정의해야 합니다.",
  });
});

it("G-AUTHOR preview uses draft placements and real party-size composition without changing the project", () => {
  const project = createCampaignProject();
  const pack = compileContentPack(project.content);
  const before = JSON.stringify(project);
  const solo = previewCampaignEncounter(pack, project.activeAdventureId, "encounter.willow-rescue", 1);
  const trio = previewCampaignEncounter(pack, project.activeAdventureId, "encounter.willow-rescue", 3);
  expect(solo.definition.scenario.actors.filter(a => a.team === "heroes")).toHaveLength(1);
  expect(solo.definition.scenario.actors.filter(a => a.team === "enemies")).toHaveLength(2);
  expect(trio.definition.scenario.actors.filter(a => a.team === "heroes")).toHaveLength(3);
  expect(trio.definition.scenario.actors.filter(a => a.team === "enemies")).toHaveLength(4);
  expect(() => previewCampaignEncounter(pack, project.activeAdventureId, "encounter.flanking-training", 1)).toThrow("Party size");
  expect(JSON.stringify(project)).toBe(before);
});

it("G-AUTHOR new campaigns own copied maps, object links, dialogue, scenery and reward progression", () => {
  const original = createCampaignProject();
  const revision = campaignRevision(original);
  const next = duplicateCampaign(original, original.activeAdventureId, "adventure.new-story", "새 모험");
  expect(validateCampaignProject(next, context)).toEqual([]);
  const source = original.content.adventures.find(a => a.id === original.activeAdventureId)!;
  const copy = next.content.adventures.at(-1)!;
  expect(next.activeAdventureId).toBe(original.activeAdventureId);
  expect(copy.encounterIds).toHaveLength(source.encounterIds.length);
  expect(copy.encounterIds.every(id => !source.encounterIds.includes(id))).toBe(true);
  expect(copy.rewards.map(r => r.choices)).toEqual(source.rewards.map(r => r.choices));
  expect(copy.rewards.every(r => copy.encounterIds.includes(r.afterEncounterId))).toBe(true);
  expect(copy.experienceAwards.map(r => r.amount)).toEqual(source.experienceAwards.map(r => r.amount));
  const field = copy.encounterIds[source.encounterIds.indexOf("encounter.willow-rescue")]!;
  const scenario = next.content.scenarios.find(s => s.id === field)!;
  expect(scenario.map.objects.every(o => scenario.map.tiles.some(t => t.id === o.interaction.targetTileId))).toBe(true);
  expect(next.presentation.elevations.maps[field]).toEqual(original.presentation.elevations.maps["encounter.willow-rescue"]);
  expect(next.presentation.scenery.filter(s => s.scenarioId === field).map(s => s.cells))
    .toEqual(original.presentation.scenery.filter(s => s.scenarioId === "encounter.willow-rescue").map(s => s.cells));
  expect(next.dialogue.bindings.encounters[field]!.sceneId).not.toBe(original.dialogue.bindings.encounters["encounter.willow-rescue"]!.sceneId);
  expect(campaignRevision(original)).toBe(revision);
  expect(() => duplicateCampaign(next, original.activeAdventureId, copy.id, "다시")).toThrow("중복");
});

it("G-AUTHOR custom object template places a real destructible and resolves its image without a renderer branch", () => {
  const source = createCampaignProject();
  const custom = { id: "test-crate", name: "보급 상자", visual: "object.chest", interaction: "destroy-obstacle" as const };
  const project = { ...source, content: { ...source.content, traits: [...source.content.traits,
    { id: custom.id, name: "Crate", source: "cardguild" as const, category: "terrain" as const,
      description: "파괴 가능한 보급 상자", cardGrants: [], actionGrants: [] }] },
    presentation: { ...source.presentation, objects: [...source.presentation.objects, custom] } };
  const updated = placeCampaignObject(project, "encounter.willow-rescue", custom.id, { x: 0, y: 0 });
  expect(validateCampaignProject(updated, context)).toEqual([]);
  const pack = compileContentPack({ ...updated.content, scenarios: updated.content.scenarios.map(s => s.id !== "encounter.willow-rescue" ? s : {
    ...s, partySpawnSlots: s.partySpawnSlots.map(slot => slot.seat === 1 ? { ...slot, position: { x: 0, y: 1 } } : slot),
  }) });
  const scenario = pack.scenarios["encounter.willow-rescue"]!;
  const object = Object.values(scenario.map.objects).find(o => o.traits.some(t => t.id === custom.id))!;
  expect(object.interaction).toEqual({ kind: "destroy-obstacle", targetTileId: "forest-0,0" });
  expect(scenario.map.tiles["0,0"]!.traits.map(t => t.id)).toContain("blocked");
  expect(campaignObjectVisual(object, updated.presentation.objects)).toBe("object.chest");
  const definition = { scenario, content: pack.combatContent, contentIdentity: getContentIdentity(pack) };
  let combat = createCombat(definition, 60).state;
  for (let i = 0; i < 6 && combat.turn.activeActorId !== "hero"; i++)
    combat = play(combat, { type: "end-turn", actorId: combat.turn.activeActorId, facing: combat.actors[combat.turn.activeActorId]!.facing }, definition);
  expect(combat.turn.activeActorId).toBe("hero");
  const actions = combat.turn.actionsRemaining;
  combat = play(combat, { type: "use-action", actorId: "hero", action: { kind: "context", id: "destroy-obstacle" },
    target: { kind: "object", objectId: object.id } }, definition);
  expect(combat.map.objects[object.id]!.used).toBe(true);
  expect(combat.turn.actionsRemaining).toBe(actions - 1);
  expect(combat.map.tiles["0,0"]!.traits.some(t => t.id === "blocked")).toBe(false);
  expect(source.content.scenarios.find(s => s.id === scenario.id)!.map.objects.some(o => o.id === object.id)).toBe(false);
  expect(() => placeCampaignObject(updated, scenario.id, custom.id, { x: 0, y: 0 })).toThrow("비어 있는");
});

it("G-AUTHOR resizing reindexes heights by position and refuses to truncate placed content", () => {
  const project = createCampaignProject();
  const id = "encounter.willow-rescue";
  const updated = resizeCampaignMap(project, id, 21, 20);
  const before = project.presentation.elevations.maps[id]!;
  const after = updated.presentation.elevations.maps[id]!;
  for (let y = 0; y < 20; y++) {
    expect(after.slice(y * 21, y * 21 + 20)).toEqual(before.slice(y * 20, y * 20 + 20));
    expect(after[y * 21 + 20]).toBe(0);
  }
  expect(validateCampaignProject(updated, context)).toEqual([]);
  expect(() => resizeCampaignMap(project, id, 3, 3)).toThrow("먼저 옮기세요");
  expect(project.presentation.elevations.maps[id]).toEqual(before);
});

it("G-AUTHOR refuses unknown object visuals, unsupported interactions and ambiguous trait bindings", () => {
  const project = createCampaignProject();
  const objects = project.presentation.objects;
  expect(validateCampaignProject({ ...project, presentation: { ...project.presentation,
    objects: [{ ...objects[0], visual: "actor.hero.aerin.front" }, ...objects.slice(1)] } }, context)
    .some(i => i.message.includes("이미지"))).toBe(true);
  expect(validateCampaignProject({ ...project, presentation: { ...project.presentation,
    objects: [...objects, objects[0]] } }, context).some(i => i.message.includes("중복"))).toBe(true);
  expect(validateCampaignProject({ ...project, presentation: { ...project.presentation,
    objects: [{ ...objects[0], interaction: "execute-script" }, ...objects.slice(1)] } }, context).length).toBeGreaterThan(0);
});
