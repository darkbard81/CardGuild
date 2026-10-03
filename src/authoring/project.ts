import Ajv2020, { type ValidateFunction } from "ajv/dist/2020.js";
import contentSchema from "../../content/schema/content-pack.schema.json";
import projectSchema from "../../content/schema/campaign-project.schema.json";
import { compileContentPack, ContentCompilationError } from "../content/compile-content";
import { fingerprintValue } from "../game/determinism";
import { assertScene } from "../scene/validation";
import type { SceneCatalog } from "../scene/types";
import type { CampaignIssue, CampaignProject } from "./types";

let cachedStructure: ValidateFunction | undefined;
function projectStructure(): ValidateFunction {
  if (!cachedStructure) {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    ajv.addSchema(contentSchema, "content");
    cachedStructure = ajv.compile(projectSchema);
  }
  return cachedStructure;
}
export interface CampaignValidationContext {
  readonly assets: Readonly<Record<string, { readonly kind: string }>>;
  readonly sceneCatalog: SceneCatalog;
  readonly objectVisuals: Readonly<Record<string, string>>;
}
export function campaignRevision(project: Omit<CampaignProject, "baseRevision">): string {
  return fingerprintValue({ version: project.version, activeAdventureId: project.activeAdventureId,
    content: project.content, dialogue: project.dialogue, presentation: project.presentation });
}
export function validateCampaignProject(input: unknown, context: CampaignValidationContext): readonly CampaignIssue[] {
  const structure = projectStructure();
  if (!structure(input)) return (structure.errors ?? []).map(error => ({
    path: error.instancePath || "/", message: `${error.message} ${JSON.stringify(error.params)}`,
  }));
  const project = input as unknown as CampaignProject;
  const issues: CampaignIssue[] = [];
  const issue = (path: string, message: string): void => { issues.push({ path, message }); };
  try { compileContentPack(project.content); }
  catch (error) {
    if (error instanceof ContentCompilationError) for (const entry of error.issues)
      issue(`/content/${entry.source}/${entry.path}`, `${entry.code}: ${entry.message}`);
    else issue("/content", String(error));
  }
  return [...issues, ...validateCampaignReferences(project, context)];
}
/** Used after the normal content gate; does not compile the same game pack again. */
export function validateCampaignReferences(project: CampaignProject, context: CampaignValidationContext): readonly CampaignIssue[] {
  const issues: CampaignIssue[] = [];
  const issue = (path: string, message: string): void => { issues.push({ path, message }); };
  if (!project.content.adventures.some(a => a.id === project.activeAdventureId))
    issue("/activeAdventureId", "실행할 캠페인을 찾을 수 없습니다.");
  const scenarios = new Map(project.content.scenarios.map(s => [s.id, s]));
  for (const [id, heights] of Object.entries(project.presentation.elevations.maps)) {
    const map = scenarios.get(id)?.map;
    if (!map || heights.length !== map.width * map.height)
      issue(`/presentation/elevations/maps/${id}`, "높이 배열은 존재하는 맵의 타일 수와 같아야 합니다.");
  }
  for (const id of Object.keys(project.presentation.backgrounds)) if (!scenarios.has(id))
    issue(`/presentation/backgrounds/${id}`, "배경에 연결된 인카운터가 없습니다.");
  for (const [index, entry] of project.presentation.scenery.entries()) {
    const map = scenarios.get(entry.scenarioId)?.map;
    if (!map || context.assets[context.objectVisuals[entry.visual] ?? ""]?.kind !== "object" ||
      entry.cells.some(([x,y]) => !Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= map.width || y >= map.height))
      issue(`/presentation/scenery/${index}`, "배경 오브젝트의 이미지·맵·좌표를 확인하세요.");
  }
  const { scenes, bindings } = project.dialogue;
  for (const [id, scene] of Object.entries(scenes)) {
    if (scene.id !== id) issue(`/dialogue/scenes/${id}`, "대사 ID와 저장 키가 다릅니다.");
    try { assertScene(scene, context.sceneCatalog); }
    catch (error) { issue(`/dialogue/scenes/${id}`, String(error)); }
  }
  for (const [key, id] of Object.entries(bindings)) if (typeof id === "string" && !Object.hasOwn(scenes, id))
    issue(`/dialogue/bindings/${key}`, "연결한 대사가 없습니다.");
  for (const [id, binding] of Object.entries(bindings.encounters)) {
    if (!scenarios.has(id) || !Object.hasOwn(scenes, binding.sceneId))
      issue(`/dialogue/bindings/encounters/${id}`, "인카운터 또는 대사가 없습니다.");
  }
  for (const scenario of scenarios.values()) {
    const opening = scenario.rules?.opening?.sceneId;
    if (opening && opening !== bindings.proneRecovery)
      issue(`/content/scenarios/${scenario.id}/rules/opening/sceneId`, "현재 전투 중 대사는 상태 회복 안내 연결을 사용해야 합니다.");
  }
  const knownTraits = new Set(project.content.traits.map(t => t.id));
  const templateIds = new Set<string>();
  for (const [index, template] of project.presentation.objects.entries()) {
    const path = `/presentation/objects/${index}`;
    if (templateIds.has(template.id)) issue(path, "중복 오브젝트 ID입니다.");
    templateIds.add(template.id);
    if (!knownTraits.has(template.id)) issue(path, `Trait 정의가 없습니다: ${template.id}`);
    if (context.assets[template.visual]?.kind !== "object") issue(path, `등록된 오브젝트 이미지가 아닙니다: ${template.visual}`);
  }
  for (const scenario of scenarios.values()) for (const object of scenario.map.objects) {
    const matched = project.presentation.objects.filter(template => object.traits.some(t => t.id === template.id));
    if (matched.length !== 1 || matched[0]!.interaction !== object.interaction.kind)
      issue(`/content/scenarios/${scenario.id}/map/objects/${object.id}`, "오브젝트의 동작과 일치하는 템플릿이 정확히 하나 필요합니다.");
  }
  return issues;
}
export function assertCampaignProject(input: unknown, context: CampaignValidationContext): asserts input is CampaignProject {
  const issues = validateCampaignProject(input, context);
  if (issues.length) throw new Error(issues.map(i => `${i.path}: ${i.message}`).join("\n"));
}
