import { expect, it } from "vitest";
import { createCampaignProject, CAMPAIGN_VALIDATION_CONTEXT as context } from "../../src/authoring/default-project";
import { campaignRevision, validateCampaignProject } from "../../src/authoring/project";
import { placeCampaignObject, resizeCampaignMap } from "../../src/authoring/edit-map";
import { campaignObjectVisual } from "../../src/presentation/campaign-objects";
import { createCombat } from "../../src/game";
import { play } from "../support/combat";
import { compileContentPack, getContentIdentity } from "../../src/content/compile-content";

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
