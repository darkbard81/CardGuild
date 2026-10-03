import { Application, RendererType } from "pixi.js";
import { createPresentationCatalog } from "../presentation";
import { applyTerrainElevations, type TerrainElevationDocument } from "../presentation/terrain-elevation";
import { PRODUCTION_CONTENT } from "../content/production-content";
import { createCombat, type Direction, type GridPosition } from "../game";
import { BattleView, type BoardHighlights } from "../pixi/battle/BattleView";

async function main(): Promise<void> {
  if (!import.meta.env.DEV) throw new Error("개발 서버에서만 사용할 수 있습니다.");
  const element = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
  const root = element<HTMLDivElement>("board");
  const catalog = createPresentationCatalog();
  await catalog.loadEncounterBundle();
  const app = new Application();
  await app.init({ resizeTo: root, background: "#111820", antialias: true, preference: new URLSearchParams(location.search).get("renderer") === "canvas" ? "canvas" : "webgl", resolution: 1,
    eventFeatures: { click: true, move: true, globalMove: false, wheel: false } });
  root.append(app.canvas);
  element<HTMLParagraphElement>("renderer").textContent = `현재 렌더러: ${app.renderer.type === RendererType.WEBGL ? "WebGL" : app.renderer.type === RendererType.WEBGPU ? "WebGPU" : "Canvas"}`;
  const scenario = element<HTMLSelectElement>("scenario");
  const height = element<HTMLInputElement>("height");
  const status = element<HTMLParagraphElement>("status");
  const message = element<HTMLParagraphElement>("message");
  const json = element<HTMLTextAreaElement>("json");
  const original = { ...catalog.tilemaps, maps: { ...catalog.tilemaps.maps } };
  let documentValue: TerrainElevationDocument = { version: 1, maps: {} };
  let selected: GridPosition | null = null;
  let hover: GridPosition | null = null;
  let revision = 0;
  let occlusionExample = false;
  const facing = element<HTMLSelectElement>("facing");
  for (const id of Object.keys(original.maps)) {
    const option = document.createElement("option"); option.value = id;
    option.textContent = PRODUCTION_CONTENT.pack.scenarios[id]?.name ?? id; scenario.append(option);
  }
  const requested = new URLSearchParams(location.search).get("scenario");
  scenario.value = requested && original.maps[requested] ? requested : "encounter.guild-practice";
  const state = () => {
    const initial = createCombat({ scenario: PRODUCTION_CONTENT.pack.scenarios[scenario.value]!, content: PRODUCTION_CONTENT.pack.combatContent,
    contentIdentity: PRODUCTION_CONTENT.contentIdentity }, 60).state;
    if (!occlusionExample) return initial;
    return { ...initial, actors: Object.fromEntries(Object.entries(initial.actors).map(([id, actor], index) => [id, { ...actor,
      facing: facing.value as Direction, position: index === 0 ? { x: 1, y: 0 } : { x: 0, y: 1 } }])) };
  };
  let combat = state();
  const highlights = (): BoardHighlights => ({ tiles: selected ? [selected] : [], actorIds: [], objectIds: [], facingPosition: null, moveBands: [] });
  const describe = (): void => {
    const map = catalog.tilemap(scenario.value);
    const value = (position: GridPosition): number => map.meta.elevations?.[position.y * map.width + position.x] ?? 0;
    status.textContent = `선택 ${selected ? `${selected.x},${selected.y} · 높이 ${value(selected)}` : "없음"} / 호버 ${hover ? `${hover.x},${hover.y}` : "없음"}`;
    status.dataset.revision = String(revision);
  };
  const view = new BattleView(app, catalog, {
    onPick: pick => { selected = pick.position; height.disabled = false; height.value = String(catalog.tilemap(scenario.value).meta.elevations?.[selected.y * combat.map.width + selected.x] ?? 0); view.updateHighlights(highlights()); describe(); },
    onHoverCell: position => { hover = position; describe(); }, onFacingPoint: () => {}, onFacingAim: () => {},
    safeArea: () => ({ left: 0, top: 0, right: 0, bottom: 0 }),
  });
  const update = (): void => {
    const pack = applyTerrainElevations(original, documentValue);
    // The preview owns a separate catalog instance. No gameplay map, save or server writes.
    Object.assign(catalog.tilemaps.maps, pack.maps);
    combat = state(); revision++; view.render(combat, highlights());
    height.disabled = !selected;
    if (selected) height.value = String(catalog.tilemap(scenario.value).meta.elevations?.[selected.y * combat.map.width + selected.x] ?? 0);
    describe();
  };
  const setValues = (values: readonly number[]): void => {
    const candidate = { version: 1 as const, maps: { ...documentValue.maps, [scenario.value]: values } };
    applyTerrainElevations(original, candidate); documentValue = candidate; update();
  };
  scenario.onchange = () => { occlusionExample = false; selected = null; hover = null; height.disabled = true; update(); };
  height.onchange = () => {
    if (!selected) return;
    const map = catalog.tilemap(scenario.value);
    const values = [...(map.meta.elevations ?? new Array<number>(map.width * map.height).fill(0))];
    values[selected.y * map.width + selected.x] = Number(height.value);
    try { setValues(values); message.textContent = ""; } catch (error) { message.textContent = String(error); }
  };
  facing.onchange = () => update();
  element<HTMLInputElement>("transparency").onchange = event => {
    view.setTerrainOcclusionEnabled((event.target as HTMLInputElement).checked);
    app.render();
  };
  element<HTMLButtonElement>("occlusion").onclick = () => {
    scenario.value = "encounter.guild-practice"; occlusionExample = true; selected = null; hover = null;
    setValues([0, 0, 0, 0, 4, 0, 0, 0, 0]);
  };
  element<HTMLButtonElement>("sample").onclick = () => {
    occlusionExample = false;
    const map = catalog.tilemap(scenario.value);
    setValues(Array.from({ length: map.width * map.height }, (_, i) => [0, 1, 2, 4][i % 4]!));
  };
  element<HTMLButtonElement>("reset").onclick = () => setValues(new Array<number>(combat.map.width * combat.map.height).fill(0));
  element<HTMLButtonElement>("export").onclick = () => { json.value = JSON.stringify(documentValue, null, 2); message.textContent = "높이 JSON을 복사하거나 파일로 저장하세요."; };
  element<HTMLButtonElement>("import").onclick = () => {
    try { const input: unknown = JSON.parse(json.value); applyTerrainElevations(original, input); documentValue = input as TerrainElevationDocument;
      selected = null; hover = null; height.disabled = true; update(); message.textContent = "높이를 복원했습니다.";
    } catch (error) { message.textContent = String(error); }
  };
  update();
  window.addEventListener("beforeunload", () => { view.destroy(); void catalog.unload(); app.destroy({ removeView: true }, { children: true }); }, { once: true });
}
void main().catch(error => { const target = document.getElementById("message"); if (target) target.textContent = String(error); });
