import type { CampaignProject } from "./types";

/** Copy all encounter-owned data; callers decide which campaign links the result. */
export function duplicateCampaignEncounter(project: CampaignProject, sourceId: string, id: string, name: string): CampaignProject {
  if (!id.trim() || !name.trim() || project.content.scenarios.some(s => s.id === id))
    throw new Error("중복되지 않는 인카운터 ID와 이름을 입력하세요.");
  const source = project.content.scenarios.find(s => s.id === sourceId);
  if (!source) throw new Error("복제할 인카운터가 없습니다.");
  const tileIds = new Map(source.map.tiles.map(t => [t.id, `${id}.tile.${t.position.x}.${t.position.y}`]));
  const copy = { ...source, id, name, map: { ...source.map,
    tiles: source.map.tiles.map(t => ({ ...t, id: tileIds.get(t.id)! })),
    objects: source.map.objects.map(o => ({ ...o, interaction: { ...o.interaction, targetTileId: tileIds.get(o.interaction.targetTileId)! } })),
  } };
  const binding = project.dialogue.bindings.encounters[sourceId];
  const sceneId = `${id}.briefing`;
  if (binding && Object.hasOwn(project.dialogue.scenes, sceneId)) throw new Error(`대사 ID가 이미 있습니다: ${sceneId}`);
  return structuredClone({ ...project, content: { ...project.content, scenarios: [...project.content.scenarios, copy] },
    dialogue: !binding ? project.dialogue : {
      scenes: { ...project.dialogue.scenes, [sceneId]: { ...project.dialogue.scenes[binding.sceneId]!, id: sceneId } },
      bindings: { ...project.dialogue.bindings, encounters: { ...project.dialogue.bindings.encounters, [id]: { ...binding, sceneId } } },
    },
    presentation: { ...project.presentation,
      elevations: { version: 1, maps: { ...project.presentation.elevations.maps,
        [id]: project.presentation.elevations.maps[sourceId] ?? new Array<number>(source.map.width * source.map.height).fill(0),
      } },
      backgrounds: { ...project.presentation.backgrounds, ...(project.presentation.backgrounds[sourceId] ? { [id]: project.presentation.backgrounds[sourceId]! } : {}) },
      scenery: [...project.presentation.scenery, ...project.presentation.scenery.filter(s => s.scenarioId === sourceId).map(s => ({ ...s, scenarioId: id }))],
    },
  });
}

/** Start an independently editable campaign with its maps, dialogue, rewards and ending. */
export function duplicateCampaign(project: CampaignProject, sourceId: string, id: string, name: string): CampaignProject {
  if (!id.trim() || !name.trim() || project.content.adventures.some(a => a.id === id))
    throw new Error("중복되지 않는 캠페인 ID와 이름을 입력하세요.");
  const source = project.content.adventures.find(a => a.id === sourceId);
  if (!source) throw new Error("복제할 캠페인이 없습니다.");
  const ids = new Map(source.encounterIds.map((old, index) => [old, `${id}.encounter-${index + 1}`]));
  let next = project;
  for (const [old, encounterId] of ids) next = duplicateCampaignEncounter(next, old, encounterId, project.content.scenarios.find(s => s.id === old)!.name);
  return { ...next, authoredAdventureIds: [...next.authoredAdventureIds, id], content: { ...next.content, adventures: [...next.content.adventures, {
    ...structuredClone(source), id, name, encounterIds: [...ids.values()],
    experienceAwards: source.experienceAwards.map(award => ({ ...award, afterEncounterId: ids.get(award.afterEncounterId)! })),
    rewards: source.rewards.map((reward, index) => ({ ...structuredClone(reward), id: `${id}.reward-${index + 1}`, afterEncounterId: ids.get(reward.afterEncounterId)! })),
  }] } };
}
