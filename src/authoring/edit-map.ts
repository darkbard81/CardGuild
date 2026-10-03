import type { ScenarioSource } from "../content/content-types";
import type { GridPosition } from "../game/types";
import type { CampaignProject } from "./types";

const at = (a: GridPosition, b: GridPosition): boolean => a.x === b.x && a.y === b.y;
function requireScenario(project: CampaignProject, id: string): ScenarioSource {
  const scenario = project.content.scenarios.find(s => s.id === id);
  if (!scenario) throw new Error(`인카운터가 없습니다: ${id}`);
  return scenario;
}
function replaceScenario(project: CampaignProject, scenario: ScenarioSource): CampaignProject {
  return { ...project, content: { ...project.content, scenarios: project.content.scenarios.map(s => s.id === scenario.id ? scenario : s) } };
}
export function resizeCampaignMap(project: CampaignProject, id: string, width: number, height: number): CampaignProject {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 3 || height < 3 || width > 40 || height > 40)
    throw new Error("편집 맵 크기는 3~40 정수입니다.");
  const scenario = requireScenario(project, id);
  const outside = (p: GridPosition): boolean => p.x >= width || p.y >= height;
  if ([...scenario.placements, ...scenario.partySpawnSlots, ...scenario.map.objects].some(entry => outside(entry.position)))
    throw new Error("잘리는 영역의 캐릭터·시작 위치·오브젝트를 먼저 옮기세요.");
  const heights = project.presentation.elevations.maps[id];
  const tileAt = new Map(scenario.map.tiles.map(t => [`${t.position.x},${t.position.y}`, t]));
  const tiles = Array.from({ length: width * height }, (_, i) => {
    const position = { x: i % width, y: Math.floor(i / width) };
    return tileAt.get(`${position.x},${position.y}`) ?? { id: `${id}.tile.${position.x}.${position.y}`, position, traits: [{ id: "open" }] };
  });
  const keptIds = new Set(tiles.map(tile => tile.id));
  if (scenario.map.objects.some(object => !keptIds.has(object.interaction.targetTileId)))
    throw new Error("잘리는 영역에 오브젝트의 연결 대상이 있습니다.");
  const changed = replaceScenario(project, { ...scenario, map: { ...scenario.map, width, height, tiles } });
  return { ...changed, presentation: { ...changed.presentation, elevations: { version: 1, maps: {
    ...changed.presentation.elevations.maps,
    [id]: tiles.map(tile => tile.position.x < scenario.map.width && tile.position.y < scenario.map.height
      ? heights?.[tile.position.y * scenario.map.width + tile.position.x] ?? 0 : 0),
  } } } };
}
export function placeCampaignObject(project: CampaignProject, scenarioId: string, templateId: string,
  position: GridPosition, targetTileId?: string): CampaignProject {
  const scenario = requireScenario(project, scenarioId);
  const template = project.presentation.objects.find(t => t.id === templateId);
  if (!template) throw new Error(`오브젝트 템플릿이 없습니다: ${templateId}`);
  const tile = scenario.map.tiles.find(t => at(t.position, position));
  if (!tile || [...scenario.map.objects, ...scenario.partySpawnSlots, ...scenario.placements].some(entry => at(entry.position, position)))
    throw new Error("비어 있는 맵 타일을 선택하세요.");
  if (tile.traits.some(t => ["blocked", "impassable", "gate", "obstacle"].includes(t.id)))
    throw new Error("걸을 수 있는 타일에 오브젝트를 배치하세요.");
  const target = template.interaction === "destroy-obstacle" ? tile : scenario.map.tiles.find(t => t.id === targetTileId);
  if (!target || (template.interaction === "open-gate" && !target.traits.some(t => t.id === "gate")))
    throw new Error("레버에 연결할 닫힌 성문 타일을 선택하세요.");
  const object = { id: `${scenarioId}.object.${template.id}.${position.x}.${position.y}`, name: template.name,
    position: { ...position }, traits: [{ id: template.id }],
    interaction: { kind: template.interaction, targetTileId: target.id }, used: false };
  const tiles = template.interaction !== "destroy-obstacle" ? scenario.map.tiles : scenario.map.tiles.map(t => t.id !== tile.id ? t : {
    ...t, traits: [...t.traits.filter(trait => trait.id !== "open"), { id: "blocked" }, { id: "obstacle" }],
  });
  return replaceScenario(project, { ...scenario, map: { ...scenario.map, tiles, objects: [...scenario.map.objects, object] } });
}
