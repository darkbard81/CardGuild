import { Application } from "pixi.js";
import generation from "../../art/source/generation-plan.json";
import { CAMPAIGN_VALIDATION_CONTEXT } from "../authoring/default-project";
import { assertCampaignProject } from "../authoring/project";
import type { CampaignProject } from "../authoring/types";
import { previewCampaignEncounter } from "../authoring/preview";
import { compileContentPack } from "../content/compile-content";
import type { PartySizeNumber } from "../content/content-types";
import { createCombat, type CombatState, type GridPosition } from "../game";
import { createPresentationCatalog } from "../presentation";
import { buildPresentationTilemaps } from "../presentation/build-tilemaps";
import { applyTerrainElevations } from "../presentation/terrain-elevation";
import { BattleView, type BoardHighlights } from "../pixi/battle/BattleView";
import "./campaign-preview.css";

if (!import.meta.env.DEV) throw new Error("개발 서버에서만 사용할 수 있습니다.");
const status = document.getElementById("preview-status")!;
const error = document.getElementById("preview-error")!;
const party = document.getElementById("party-size") as HTMLSelectElement;
let started = false;
window.addEventListener("message", event => {
  if (started || event.source !== parent || event.origin !== location.origin || event.data?.type !== "campaign-preview") return;
  started = true;
  void main(event.data.project, event.data.adventureId, event.data.scenarioId).catch(reason => { error.textContent = String(reason); });
});

async function main(input: unknown, adventureId: string, scenarioId: string): Promise<void> {
  assertCampaignProject(input, CAMPAIGN_VALIDATION_CONTEXT);
  const project: CampaignProject = input;
  const pack = compileContentPack(project.content);
  const source = pack.scenarioSources[scenarioId];
  if (!source) throw new Error("미리볼 인카운터가 없습니다.");
  const range = source.rules?.partySize ?? { min: 1, max: 3 };
  for (const option of party.options) option.disabled = Number(option.value) < range.min || Number(option.value) > range.max;
  party.value = String(range.min);
  const tilemaps = applyTerrainElevations(buildPresentationTilemaps(project.content.scenarios, {
    ...generation.presentation, scenery: project.presentation.scenery,
  }), project.presentation.elevations);
  const catalog = createPresentationCatalog({ tilemaps, backgrounds: project.presentation.backgrounds, objects: project.presentation.objects });
  status.textContent = "전장 이미지를 불러오고 있습니다.";
  await catalog.loadEncounterBundle();
  const board = document.getElementById("board")!;
  const app = new Application();
  await app.init({ resizeTo: board, background: "#111820", antialias: true, preference: "webgl", resolution: 1,
    eventFeatures: { click: true, move: true, globalMove: false, wheel: false } });
  board.append(app.canvas);
  app.canvas.setAttribute("aria-label", "실제 전장 렌더링");
  let selected: GridPosition | null = null;
  let combat: CombatState;
  let revision = 0;
  const highlights = (): BoardHighlights => ({ tiles: selected ? [selected] : [], actorIds: [], objectIds: [], facingPosition: null, moveBands: [] });
  const view = new BattleView(app, catalog, {
    onPick: pick => {
      selected = pick.position; view.updateHighlights(highlights());
      const { x, y } = selected;
      const height = tilemaps.maps[scenarioId]!.meta.elevations?.[y * source.map.width + x] ?? 0;
      const objects = Object.values(combat.map.objects).filter(o => o.position.x === x && o.position.y === y);
      document.getElementById("preview-selection")!.textContent = `선택 ${x},${y} · 높이 ${height}${objects.map(o => ` · ${o.name}`).join("")}`;
    },
    onHoverCell: () => {}, onFacingPoint: () => {}, onFacingAim: () => {},
    safeArea: () => ({ left: 0, top: 0, right: 0, bottom: 0 }),
  });
  const update = (): void => {
    try {
      const encounter = previewCampaignEncounter(pack, adventureId, scenarioId, Number(party.value) as PartySizeNumber);
      combat = createCombat(encounter.definition, encounter.seed).state;
      view.render(combat, highlights()); app.render();
      const actors = Object.values(combat.actors);
      status.textContent = `${source.name} · 아군 ${actors.filter(a => a.team === "heroes").length}명 · 적 ${actors.filter(a => a.team === "enemies").length}명 · 오브젝트 ${Object.keys(combat.map.objects).length}개`;
      status.dataset.revision = String(++revision); error.textContent = "";
    } catch (reason) { error.textContent = String(reason); }
  };
  party.onchange = update; update();
  window.addEventListener("pagehide", () => { view.destroy(); app.destroy({ removeView: true }, { children: true }); }, { once: true });
}
