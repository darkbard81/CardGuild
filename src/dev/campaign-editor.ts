import "./campaign-editor.css";
import { createCampaignProject, CAMPAIGN_VALIDATION_CONTEXT as context } from "../authoring/default-project";
import { assertCampaignProject, campaignRevision, validateCampaignProject } from "../authoring/project";
import { placeCampaignObject, resizeCampaignMap } from "../authoring/edit-map";
import type { CampaignProject } from "../authoring/types";
import type { AdventureDefinition, ScenarioSource, RewardGrant } from "../content/content-types";
import type { Direction } from "../game/types";
import type { SceneDefinition } from "../scene/types";
import { ScenePlayer } from "../scene/player";

if (!import.meta.env.DEV) throw new Error("캠페인 편집기는 개발 서버에서만 사용할 수 있습니다.");
const root = document.querySelector<HTMLDivElement>("#campaign-editor")!;
const STORAGE = "cardguild.authoring.draft.v1";
const initial = createCampaignProject();
let project = initial;
let adventureId = project.activeAdventureId;
let scenarioId = project.content.adventures.find(a => a.id === adventureId)!.encounterIds.at(-4)!;
let tab = "map";
let selected = { x: 0, y: 0 };
let notice = "게임 원본을 불러왔습니다. 편집은 이 브라우저의 초안에만 반영됩니다.";
let failed = false;
let sceneIndex = 0;
let editingEnemyId = "";
const undo: CampaignProject[] = [], redo: CampaignProject[] = [];
const escape = (value: unknown): string => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const input = (id: string): HTMLInputElement => document.getElementById(id) as HTMLInputElement;
const value = (id: string): string => input(id).value;
const number = (id: string): number => Number(value(id));
const scenario = (): ScenarioSource => project.content.scenarios.find(s => s.id === scenarioId)!;
const adventure = (): AdventureDefinition => project.content.adventures.find(a => a.id === adventureId)!;
const options = (entries: readonly { id: string; name: string }[], current: string): string => entries.map(entry => `<option value="${escape(entry.id)}" ${entry.id === current ? "selected" : ""}>${escape(entry.name)}</option>`).join("");
function report(error: unknown): void { failed = true; notice = String(error); const status = document.getElementById("status")!; status.textContent = notice; status.className = "status error"; }
function persist(): void {
  try { localStorage.setItem(STORAGE, JSON.stringify(project)); }
  catch { notice += "\n브라우저 저장 공간이 부족합니다. JSON 내보내기로 초안을 보관하세요."; }
}
function commit(next: CampaignProject, message: string): void {
  assertCampaignProject(next, context);
  undo.push(project); if (undo.length > 30) undo.shift(); redo.length = 0;
  project = next; notice = message; failed = false; persist(); render();
}
function changeScenario(next: ScenarioSource): void { commit({ ...project, content: { ...project.content,
  scenarios: project.content.scenarios.map(s => s.id === scenarioId ? next : s) } }, "인카운터 초안을 저장했습니다."); }
function changeAdventure(next: AdventureDefinition): void { commit({ ...project, content: { ...project.content,
  adventures: project.content.adventures.map(a => a.id === adventureId ? next : a) } }, "캠페인 초안을 저장했습니다."); }
function bind(id: string, action: () => void): void { document.getElementById(id)?.addEventListener("click", () => { try { action(); } catch (error) { report(error); } }); }
function select(id: string, action: () => void): void { document.getElementById(id)?.addEventListener("change", () => { try { action(); } catch (error) { report(error); } }); }
function normaliseSelection(): void {
  if (!project.content.adventures.some(a => a.id === adventureId)) adventureId = project.activeAdventureId;
  if (!project.content.scenarios.some(s => s.id === scenarioId)) scenarioId = adventure().encounterIds[0]!;
  selected = { x: Math.min(selected.x, scenario().map.width - 1), y: Math.min(selected.y, scenario().map.height - 1) };
}
function render(): void {
  normaliseSelection();
  root.innerHTML = `<header><h1>캠페인 제작</h1><p class="muted">맵부터 전투·대사·보상까지 · 게임 DB와 실행 중인 캠페인은 변경하지 않습니다.</p>
  <div class="bar"><button id="export">JSON 내보내기</button><label style="margin:0">JSON 불러오기 <input id="import" type="file" accept="application/json,.json" style="display:inline;width:200px"></label><button id="restore">저장한 초안 복원</button><button id="undo" ${undo.length ? "" : "disabled"}>실행 취소</button><button id="redo" ${redo.length ? "" : "disabled"}>다시 실행</button><button id="validate">검증</button></div></header>
  <p id="status" role="status" class="status ${failed ? "error" : ""}">${escape(notice)}</p><div class="shell"><aside>
  <div class="field"><label for="adventure">편집 캠페인</label><select id="adventure">${options(project.content.adventures, adventureId)}</select></div>
  <div class="field"><label for="scenario">인카운터</label><select id="scenario">${options(project.content.scenarios, scenarioId)}</select></div>
  <h2>진행 순서</h2><ol>${adventure().encounterIds.map(id => `<li><button data-stage="${escape(id)}" ${id === scenarioId ? 'aria-current="step"' : ""}>${escape(project.content.scenarios.find(s => s.id === id)!.name)}</button></li>`).join("")}</ol>
  <div class="bar"><button id="up">위로</button><button id="down">아래로</button></div>
  <details><summary>인카운터 복제</summary><div class="field"><label for="new-id">새 인카운터 ID</label><input id="new-id" placeholder="encounter.my-field"></div><div class="field"><label for="new-name">새 인카운터 이름</label><input id="new-name" placeholder="새 전장"></div><button id="duplicate">현재 전장 복제·연결</button></details>
  <details><summary>캠페인 설정</summary><div class="field"><label for="campaign-name">캠페인 이름</label><input id="campaign-name" value="${escape(adventure().name)}"></div><div class="field"><label for="campaign-description">소개</label><textarea id="campaign-description">${escape(adventure().description)}</textarea></div><div class="field"><label for="ending-title">엔딩 제목</label><input id="ending-title" value="${escape(adventure().ending?.title)}"></div><div class="field"><label for="ending-text">엔딩 본문</label><textarea id="ending-text">${escape(adventure().ending?.description)}</textarea></div><button id="campaign-save">캠페인 저장</button></details>
  <p class="muted">초안 자동 저장 · JSON 파일은 Codex와 함께 편집할 수 있습니다. 게임 반영은 CLI의 plan → apply를 사용합니다.</p></aside>
  <main><nav aria-label="편집 영역">${[["map", "맵"], ["encounter", "인카운터"], ["dialogue", "다이얼로그"], ["reward", "보상"], ["objects", "오브젝트"]].map(([id, title]) => `<button data-tab="${id}" aria-pressed="${tab === id}">${title}</button>`).join("")}</nav><section id="panel"></section>
  <details><summary>전체 프로젝트 JSON</summary><p class="muted">캠페인 추가, 고급 규칙, Trait·에셋 연결을 편집할 수 있습니다. 검증 실패 시 현재 초안은 보존됩니다.</p><textarea id="project-json" style="height:300px">${escape(JSON.stringify(project, null, 2))}</textarea><button id="project-apply">프로젝트 JSON 적용</button></details></main></div>`;
  select("adventure", () => { adventureId = value("adventure"); scenarioId = adventure().encounterIds[0]!; sceneIndex = 0; render(); });
  select("scenario", () => { scenarioId = value("scenario"); sceneIndex = 0; render(); });
  root.querySelectorAll<HTMLButtonElement>("[data-stage]").forEach(button => button.onclick = () => { scenarioId = button.dataset.stage!; sceneIndex = 0; render(); });
  root.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach(button => button.onclick = () => { tab = button.dataset.tab!; render(); });
  bind("undo", () => { redo.push(project); project = undo.pop()!; notice = "이전 편집으로 되돌렸습니다."; persist(); render(); });
  bind("redo", () => { undo.push(project); project = redo.pop()!; notice = "편집을 다시 적용했습니다."; persist(); render(); });
  bind("validate", () => { const issues = validateCampaignProject(project, context); if (issues.length) throw new Error(issues.map(i => `${i.path}: ${i.message}`).join("\n")); notice = "검증 통과: 맵·배치·대사·보상·오브젝트 참조가 유효합니다."; failed = false; render(); });
  bind("export", () => { assertCampaignProject(project, context); const url = URL.createObjectURL(new Blob([JSON.stringify(project, null, 2) + "\n"], { type: "application/json" })); const a = document.createElement("a"); a.href = url; a.download = "campaign-project.json"; a.click(); URL.revokeObjectURL(url); });
  document.getElementById("import")!.addEventListener("change", async event => { const file = (event.target as HTMLInputElement).files?.[0]; if (!file) return; try { const candidate: unknown = JSON.parse(await file.text()); assertCampaignProject(candidate, context); commit(candidate, "프로젝트를 불러왔습니다."); } catch (error) { report(error); } });
  bind("restore", () => { const saved = localStorage.getItem(STORAGE); if (!saved) throw new Error("저장한 초안이 없습니다."); const candidate: unknown = JSON.parse(saved); assertCampaignProject(candidate, context); commit(candidate, candidate.baseRevision === initial.baseRevision ? "저장한 초안을 복원했습니다." : "초안을 복원했습니다. 저장소가 바뀌었으므로 CLI 반영 전에 최신 원본과 병합하세요."); });
  bind("project-apply", () => { const candidate: unknown = JSON.parse(value("project-json")); assertCampaignProject(candidate, context); commit(candidate, "프로젝트 JSON을 적용했습니다."); });
  bind("campaign-save", () => changeAdventure({ ...adventure(), name: value("campaign-name"), description: value("campaign-description"),
    ...(value("ending-title").trim() ? { ending: { title: value("ending-title"), description: value("ending-text") } } : {}) }));
  for (const [id, delta] of [["up", -1], ["down", 1]] as const) bind(id, () => { const ids = [...adventure().encounterIds]; const at = ids.indexOf(scenarioId); if (at < 0 || at + delta < 0 || at + delta >= ids.length) return; [ids[at], ids[at + delta]] = [ids[at + delta]!, ids[at]!]; changeAdventure({ ...adventure(), encounterIds: ids }); });
  bind("duplicate", duplicateEncounter);
  if (tab === "map") mapPanel(); else if (tab === "encounter") encounterPanel(); else if (tab === "dialogue") dialoguePanel(); else if (tab === "reward") rewardPanel(); else objectPanel();
}
function duplicateEncounter(): void {
  const id = value("new-id").trim(), name = value("new-name").trim();
  if (!id || !name || project.content.scenarios.some(s => s.id === id)) throw new Error("중복되지 않는 ID와 이름을 입력하세요.");
  const source = scenario();
  const tileIds = new Map(source.map.tiles.map(t => [t.id, `${id}.tile.${t.position.x}.${t.position.y}`]));
  const copy = { ...source, id, name, map: { ...source.map, tiles: source.map.tiles.map(t => ({ ...t, id: tileIds.get(t.id)! })),
    objects: source.map.objects.map(o => ({ ...o, interaction: { ...o.interaction, targetTileId: tileIds.get(o.interaction.targetTileId)! } })) } };
  const oldBinding = project.dialogue.bindings.encounters[source.id];
  const newScene = oldBinding ? { ...project.dialogue.scenes[oldBinding.sceneId]!, id: `${id}.briefing` } : null;
  const next: CampaignProject = { ...project, content: { ...project.content, scenarios: [...project.content.scenarios, copy], adventures: project.content.adventures.map(a => a.id !== adventureId ? a : { ...a,
    encounterIds: [...a.encounterIds, id], experienceAwards: [...a.experienceAwards, { afterEncounterId: id, amount: 0 }] }) },
    dialogue: newScene ? { scenes: { ...project.dialogue.scenes, [newScene.id]: newScene }, bindings: { ...project.dialogue.bindings, encounters: { ...project.dialogue.bindings.encounters, [id]: { ...oldBinding!, sceneId: newScene.id } } } } : project.dialogue,
    presentation: { ...project.presentation, scenery: [...project.presentation.scenery, ...project.presentation.scenery.filter(entry => entry.scenarioId === source.id).map(entry => ({ ...entry, scenarioId: id }))], elevations: { version: 1, maps: { ...project.presentation.elevations.maps, [id]: [...(project.presentation.elevations.maps[source.id] ?? new Array(source.map.width * source.map.height).fill(0))] } },
      backgrounds: { ...project.presentation.backgrounds, ...(project.presentation.backgrounds[source.id] ? { [id]: project.presentation.backgrounds[source.id]! } : {}) } } };
  assertCampaignProject(next, context); scenarioId = id; commit(next, "전장을 복제하고 캠페인 마지막에 연결했습니다. 보상은 새로 지정하세요.");
}
function mapPanel(): void {
  const s = scenario(), tile = s.map.tiles.find(t => t.position.x === selected.x && t.position.y === selected.y)!;
  const height = project.presentation.elevations.maps[s.id]?.[selected.y * s.map.width + selected.x] ?? 0;
  document.getElementById("panel")!.innerHTML = `<div class="two"><div><h2>${escape(s.name)}</h2><div class="map-scroll"><div class="map-grid" role="grid" aria-label="맵 타일" style="grid-template-columns:repeat(${s.map.width},28px)">${s.map.tiles.slice().sort((a,b) => a.position.y-b.position.y || a.position.x-b.position.x).map(t => {
    const { x, y } = t.position; const tags = t.traits.map(t => t.id); const spawn = s.partySpawnSlots.find(p => p.position.x === x && p.position.y === y); const enemy = s.placements.some(p => p.position.x === x && p.position.y === y); const object = s.map.objects.find(p => p.position.x === x && p.position.y === y);
    return `<button class="cell ${tags.includes("pond-water") ? "water" : tags.includes("forest-dirt") ? "dirt" : tags.includes("forest-leaves") ? "leaves" : "grass"} ${tags.includes("blocked") ? "blocked" : ""}" role="gridcell" aria-label="타일 ${x},${y}" aria-selected="${selected.x === x && selected.y === y}" tabindex="${selected.x === x && selected.y === y ? 0 : -1}" data-x="${x}" data-y="${y}" style="height:28px"><small>${project.presentation.elevations.maps[s.id]?.[y*s.map.width+x] ?? 0}</small>${spawn ? spawn.seat : enemy ? "적" : object ? "◆" : ""}</button>`;
  }).join("")}</div></div><p class="muted">숫자 1~3: 파티 시작 · 적: 적 배치 · ◆: 오브젝트 · 오른쪽 위 숫자: 높이. 방향키로 선택하고 오른쪽에서 적용하세요.</p></div>
  <div class="panel"><h2>타일 ${selected.x},${selected.y}</h2><p>${escape(tile.traits.map(t => t.id).join(", "))}</p><div class="field"><label for="ground">지면</label><select id="ground">${options([{id:"forest-grass",name:"풀"},{id:"forest-dirt",name:"흙길"},{id:"forest-leaves",name:"낙엽"},{id:"pond-water",name:"물"},{id:"open",name:"석재 바닥"},{id:"difficult",name:"험지"},{id:"blocked",name:"벽"},{id:"gate",name:"닫힌 성문"}], tile.traits.find(t => ["forest-grass","forest-dirt","forest-leaves","pond-water"].includes(t.id))?.id ?? tile.traits[0]!.id)}</select></div><button id="paint">지면 적용</button>
  <div class="field"><label for="height">높이</label><input id="height" type="number" min="0" max="8" value="${height}"></div><button id="height-save">높이 적용</button>
  <div class="field"><label for="object-template">오브젝트</label><select id="object-template">${options(project.presentation.objects, project.presentation.objects[0]?.id ?? "")}</select></div><div class="field"><label for="gate-target">연결 성문 타일 ID</label><input id="gate-target" placeholder="레버에만 필요"></div><button id="place-object">오브젝트 배치</button>
  <div class="pair"><div class="field"><label for="width">너비</label><input id="width" type="number" min="3" max="40" value="${s.map.width}"></div><div class="field"><label for="map-height">높이(칸)</label><input id="map-height" type="number" min="3" max="40" value="${s.map.height}"></div></div><button id="resize">맵 크기 적용</button></div></div>`;
  root.querySelectorAll<HTMLButtonElement>(".cell").forEach(button => { const choose = (x: number,y: number): void => { selected={x,y}; mapPanel(); root.querySelector<HTMLButtonElement>(`.cell[data-x="${x}"][data-y="${y}"]`)?.focus(); }; button.onclick=()=>choose(Number(button.dataset.x),Number(button.dataset.y)); button.onkeydown=event=>{const dx=event.key==="ArrowLeft"?-1:event.key==="ArrowRight"?1:0;const dy=event.key==="ArrowUp"?-1:event.key==="ArrowDown"?1:0;if(dx||dy){event.preventDefault();choose(Math.max(0,Math.min(s.map.width-1,selected.x+dx)),Math.max(0,Math.min(s.map.height-1,selected.y+dy)));}}; });
  bind("paint", () => { if (s.map.objects.some(o => o.position.x===selected.x && o.position.y===selected.y)) throw new Error("오브젝트가 있는 타일은 인카운터 JSON에서 함께 수정하세요."); const ground=value("ground"); const traits=ground==="pond-water"?[{id:ground},{id:"impassable"}]:["blocked","gate","difficult","open"].includes(ground)?[{id:ground}]:[{id:ground},{id:"open"}]; changeScenario({...s,map:{...s.map,tiles:s.map.tiles.map(t=>t.id===tile.id?{...t,traits}:t)}}); });
  bind("height-save",()=>{const heights=[...(project.presentation.elevations.maps[s.id]??new Array(s.map.width*s.map.height).fill(0))];heights[selected.y*s.map.width+selected.x]=number("height");commit({...project,presentation:{...project.presentation,elevations:{version:1,maps:{...project.presentation.elevations.maps,[s.id]:heights}}}},"높이를 저장했습니다." );});
  bind("place-object",()=>commit(placeCampaignObject(project,s.id,value("object-template"),selected,value("gate-target")),"오브젝트를 배치했습니다."));
  bind("resize",()=>commit(resizeCampaignMap(project,s.id,number("width"),number("map-height")),"맵 크기를 변경했습니다."));
}
function encounterPanel(): void {
  const s = scenario();
  const enemy = s.placements.find(p => p.instanceId === editingEnemyId);
  const directions = ["north", "east", "south", "west"].map(id => ({ id, name: ({ north: "북", east: "동", south: "남", west: "서" })[id]! }));
  const actorOptions = project.content.actors.filter(a => a.statProfile.kind === "creature");
  const field = (id: string, label: string, current: unknown, type = "text"): string => `<div class="field"><label for="${id}">${label}</label><input id="${id}" type="${type}" value="${escape(current)}"></div>`;
  document.getElementById("panel")!.innerHTML = `<h2>전투 구성</h2><div class="panel">
  ${field("encounter-name", "전장 이름", s.name)}
  <div class="field"><label for="objective">전투 목표 설명</label><textarea id="objective">${escape(s.objective.description)}</textarea></div>
  <div class="field"><label for="objective-kind">승리 방식</label><select id="objective-kind">${options([{id:"defeat-all-enemies",name:"적 전멸"},{id:"resolve-objectives",name:"지정한 적·오브젝트 모두 해결"}],s.objective.kind)}</select></div>
  <details><summary>필수 목표 선택</summary><p class="muted">선택한 적과 오브젝트를 모두 해결해야 승리합니다.</p>
  ${s.placements.map(p => `<label><input type="checkbox" data-victory-enemy="${escape(p.instanceId)}" ${s.rules?.victory?.enemyIds.includes(p.instanceId)?"checked":""}>${escape(p.instanceId)}</label>`).join("")}
  ${s.map.objects.filter(o=>o.interaction.kind==="destroy-obstacle").map(o => `<label><input type="checkbox" data-victory-object="${escape(o.id)}" ${s.rules?.victory?.objectIds.includes(o.id)?"checked":""}>${escape(o.name)} (${o.position.x},${o.position.y})</label>`).join("")}</details><button id="objective-save">이름·목표 저장</button></div>
  <div class="panel"><h2>적 배치</h2><div class="field"><label for="enemy-select">편집할 적</label><select id="enemy-select">${options([{id:"",name:"새 적 추가"},...s.placements.map(p=>({id:p.instanceId,name:p.instanceId}))],enemy?.instanceId??"")}</select></div>
  ${field("enemy-id","적 인스턴스 ID",enemy?.instanceId??"")}<div class="field"><label for="enemy-definition">적 정의</label><select id="enemy-definition">${options(actorOptions,enemy?.actorDefinitionId??actorOptions[0]!.id)}</select></div>
  <div class="pair">${field("enemy-x","적 X",enemy?.position.x??selected.x,"number")}${field("enemy-y","적 Y",enemy?.position.y??selected.y,"number")}</div>
  <div class="field"><label for="enemy-facing">적 방향</label><select id="enemy-facing">${options(directions,enemy?.facing??"south")}</select></div>
  <div class="pair">${field("party-min","등장 최소 인원",enemy?.partySize?.min??1,"number")}${field("party-max","등장 최대 인원",enemy?.partySize?.max??3,"number")}</div>
  <div class="bar"><button id="enemy-save">적 배치 저장</button><button id="enemy-delete" ${enemy?"":"disabled"}>적 삭제</button></div></div>
  <div class="panel"><h2>파티 시작 위치</h2>${[1,2,3].map(seat=>{const spawn=s.partySpawnSlots.find(p=>p.seat===seat);return `<p>${seat}번 좌석</p><div class="pair">${field(`spawn-x-${seat}`,`${seat}번 X`,spawn?.position.x??"","number")}${field(`spawn-y-${seat}`,`${seat}번 Y`,spawn?.position.y??"","number")}</div><div class="field"><label for="spawn-facing-${seat}">${seat}번 방향</label><select id="spawn-facing-${seat}">${options(directions,spawn?.facing??"north")}</select></div>`;}).join("")}<p class="muted">사용하지 않는 좌석은 X와 Y를 모두 비워두세요.</p><button id="spawns-save">시작 위치 저장</button></div>
  <details><summary>인카운터 고급 JSON</summary><p class="muted">고급 rules·오브젝트 연결을 편집합니다. 실패하면 입력과 기존 초안을 보존합니다.</p><div class="field"><label for="encounter-json">인카운터 JSON</label><textarea id="encounter-json" style="height:300px">${escape(JSON.stringify(s,null,2))}</textarea></div><button id="encounter-save">인카운터 저장</button></details>`;
  bind("objective-save",()=>{
    const rules={...s.rules};
    if(value("objective-kind")==="resolve-objectives")rules.victory={enemyIds:[...root.querySelectorAll<HTMLInputElement>("[data-victory-enemy]:checked")].map(el=>el.dataset.victoryEnemy!),objectIds:[...root.querySelectorAll<HTMLInputElement>("[data-victory-object]:checked")].map(el=>el.dataset.victoryObject!)};
    else delete rules.victory;
    changeScenario({...s,name:value("encounter-name"),objective:{kind:value("objective-kind") as ScenarioSource["objective"]["kind"],description:value("objective")},rules:Object.keys(rules).length?rules:undefined});
  });
  select("enemy-select",()=>{editingEnemyId=value("enemy-select");encounterPanel();});
  bind("enemy-save",()=>{
    const entry={instanceId:value("enemy-id").trim(),actorDefinitionId:value("enemy-definition"),team:"enemies" as const,position:{x:number("enemy-x"),y:number("enemy-y")},facing:value("enemy-facing") as Direction,partySize:{min:number("party-min") as 1|2|3,max:number("party-max") as 1|2|3}};
    changeScenario({...s,placements:enemy?s.placements.map(p=>p.instanceId===enemy.instanceId?entry:p):[...s.placements,entry]});
  });
  bind("enemy-delete",()=>changeScenario({...s,placements:s.placements.filter(p=>p.instanceId!==enemy!.instanceId)}));
  bind("spawns-save",()=>{
    const slots=([1,2,3] as const).flatMap(seat=>{
      const x=value(`spawn-x-${seat}`),y=value(`spawn-y-${seat}`);
      if(!x&&!y)return [];
      if(!x||!y)throw new Error(`${seat}번 좌석의 X와 Y를 모두 입력하세요.`);
      return [{seat,position:{x:Number(x),y:Number(y)},facing:value(`spawn-facing-${seat}`) as Direction}];
    });
    changeScenario({...s,partySpawnSlots:slots});
  });
  bind("encounter-save",()=>{const next=JSON.parse(value("encounter-json")) as ScenarioSource;if(next.id!==s.id)throw new Error("ID 변경은 복제 후 캠페인 연결을 변경하세요.");changeScenario(next);});
}

function currentScene(): SceneDefinition | undefined { const binding=project.dialogue.bindings.encounters[scenarioId]; return binding ? project.dialogue.scenes[binding.sceneId] : undefined; }
function saveScene(scene: SceneDefinition): void {
  commit({...project,dialogue:{scenes:{...project.dialogue.scenes,[scene.id]:scene},bindings:{...project.dialogue.bindings,encounters:{...project.dialogue.bindings.encounters,[scenarioId]:{sceneId:scene.id,title:scenario().name,finishLabel:"전장으로 출발",...project.dialogue.bindings.encounters[scenarioId]}}}}},"다이얼로그를 저장했습니다.");
}
function dialoguePanel(): void {
  const scene=currentScene(); sceneIndex=Math.min(sceneIndex,Math.max(0,(scene?.lines.length??1)-1));const line=scene?.lines[sceneIndex];
  document.getElementById("panel")!.innerHTML=`<h2>전투 전 다이얼로그</h2><p class="muted">대사는 전투 시작 전에 재생됩니다. 취소하면 전투를 시작하지 않습니다.</p>${scene?`<div class="field"><label for="line-select">대사 순서</label><select id="line-select">${scene.lines.map((l,i)=>`<option value="${i}" ${i===sceneIndex?"selected":""}>${i+1}. ${escape(l.text.slice(0,32))}</option>`).join("")}</select></div><div class="field"><label for="speaker">화자</label><select id="speaker">${options([{id:"",name:"내레이션 / 이름을 본문에 표기"},...Object.entries(context.sceneCatalog.speakers).map(([id,s])=>({id,name:s.name}))],line?.speakerId??"")}</select></div><div class="field"><label for="expression">표정</label><select id="expression">${options(Object.keys(context.sceneCatalog.faceSets.minerva!.frames).map(id=>({id,name:id})),line?.expressionId??"neutral")}</select></div><div class="field"><label for="line-text">대사 본문</label><textarea id="line-text">${escape(line?.text)}</textarea></div><div class="bar"><button id="line-save">대사 저장</button><button id="line-add">다음 대사 추가</button><button id="line-delete" ${scene.lines.length===1?"disabled":""}>이 대사 삭제</button><button id="dialogue-preview">재생 미리보기</button></div>`:`<button id="scene-create">이 전장에 다이얼로그 만들기</button>`}`;
  bind("scene-create",()=>saveScene({id:`${scenarioId}.briefing`,lines:[{text:scenario().objective.description}]}));
  if(!scene)return;
  select("line-select",()=>{sceneIndex=number("line-select");dialoguePanel();});
  bind("line-save",()=>saveScene({...scene,lines:scene.lines.map((l,i)=>i!==sceneIndex?l:{text:value("line-text"),...(value("speaker")?{speakerId:value("speaker"),expressionId:value("expression")}:{}),...(l.audio?{audio:l.audio}:{})})}));
  bind("line-add",()=>{sceneIndex++;saveScene({...scene,lines:[...scene.lines.slice(0,sceneIndex),{text:"새 대사를 입력하세요."},...scene.lines.slice(sceneIndex)]});});
  bind("line-delete",()=>saveScene({...scene,lines:scene.lines.filter((_,i)=>i!==sceneIndex)}));
  bind("dialogue-preview",()=>previewScene(scene));
}
function previewScene(scene: SceneDefinition): void {
  const dialog=document.createElement("dialog");dialog.setAttribute("aria-label","대사 미리보기");dialog.innerHTML='<h2>대사 미리보기</h2><p class="speaker"></p><p class="dialog-text"></p><div class="bar"><button id="next-line">다음</button><button id="close-preview">닫기</button></div>';document.body.append(dialog);let revision=0;
  const player=new ScenePlayer(scene,(line,index,rev)=>{revision=rev;dialog.querySelector(".speaker")!.textContent=`${index+1}/${scene.lines.length} · ${line.speakerId?context.sceneCatalog.speakers[line.speakerId]!.name:"내레이션"}${line.expressionId?` · ${line.expressionId}`:""}`;dialog.querySelector(".dialog-text")!.textContent=line.text;},()=>{dialog.close();dialog.remove();});
  dialog.querySelector<HTMLButtonElement>("#next-line")!.onclick=()=>player.next(revision);dialog.querySelector<HTMLButtonElement>("#close-preview")!.onclick=()=>player.cancel();dialog.oncancel=event=>{event.preventDefault();player.cancel();};dialog.showModal();player.start();
}
function rewardPanel(): void {
  const a=adventure();const rewards=a.rewards.filter(r=>r.afterEncounterId===scenarioId);const amount=a.experienceAwards.find(r=>r.afterEncounterId===scenarioId)?.amount??0;
  document.getElementById("panel")!.innerHTML=`<h2>전투 후 보상</h2><p class="muted">${escape(scenario().name)} 승리 후 제공할 선택 보상입니다. 장비·카드·동료는 등록된 정의를 사용합니다.</p><div class="field"><label for="experience">경험치</label><input id="experience" type="number" min="0" value="${amount}"></div><div class="field"><label for="rewards-json">선택 보상 JSON</label><textarea id="rewards-json" style="height:240px">${escape(JSON.stringify(rewards,null,2))}</textarea></div><div class="pair"><div class="field"><label for="reward-kind">종류</label><select id="reward-kind"><option value="equipment">장비</option><option value="card">카드</option><option value="companion">동료</option></select></div><div class="field"><label for="reward-definition">정의</label><select id="reward-definition"></select></div></div><button id="reward-add">선택 항목 추가</button><button id="rewards-save">보상·경험치 저장</button>`;
  const definitions=():void=>{const kind=value("reward-kind");const entries=kind==="card"?project.content.cards:kind==="equipment"?project.content.equipment:(project.content.companions??[]).map(c=>({id:c.id,name:c.description}));document.getElementById("reward-definition")!.innerHTML=options(entries,entries[0]?.id??"");};definitions();select("reward-kind",definitions);
  bind("reward-add",()=>{const parsed=JSON.parse(value("rewards-json")) as AdventureDefinition["rewards"];const choice={kind:value("reward-kind"),definitionId:value("reward-definition")} as RewardGrant;input("rewards-json").value=JSON.stringify(parsed.length?[{...parsed[0]!,choices:[...parsed[0]!.choices,choice]},...parsed.slice(1)]:[{id:`${adventureId}.reward.${scenarioId}`,afterEncounterId:scenarioId,choices:[choice]}],null,2);});
  bind("rewards-save",()=>{if(!a.encounterIds.includes(scenarioId))throw new Error("이 전장을 편집 캠페인에 먼저 연결하세요.");const parsed=JSON.parse(value("rewards-json")) as AdventureDefinition["rewards"];if(parsed.some(r=>r.afterEncounterId!==scenarioId))throw new Error("선택한 인카운터의 보상만 편집하세요.");changeAdventure({...a,rewards:[...a.rewards.filter(r=>r.afterEncounterId!==scenarioId),...parsed],experienceAwards:a.experienceAwards.map(r=>r.afterEncounterId===scenarioId?{...r,amount:number("experience")}:r)});});
}
function objectPanel(): void {
  document.getElementById("panel")!.innerHTML=`<h2>오브젝트 라이브러리</h2><ul>${project.presentation.objects.map(o=>`<li>${escape(o.name)} · ${escape(o.id)} · ${escape(o.interaction)} · ${escape(o.visual)}</li>`).join("")}</ul><p class="muted">새 오브젝트는 기존 파괴·성문 열기 규칙과 등록된 이미지를 조합합니다. 새 이미지가 필요하면 Codex가 에셋 파이프라인에 추가할 수 있습니다.</p><div class="pair"><div class="field"><label for="template-id">오브젝트 ID</label><input id="template-id" placeholder="supply-crate"></div><div class="field"><label for="template-name">이름</label><input id="template-name" placeholder="보급 상자"></div></div><div class="field"><label for="template-visual">이미지</label><select id="template-visual">${options(Object.entries(context.assets).filter(([,a])=>a.kind==="object").map(([id])=>({id,name:id})),"object.chest")}</select></div><div class="field"><label for="template-kind">동작</label><select id="template-kind"><option value="destroy-obstacle">장애물 파괴</option><option value="open-gate">성문 열기</option></select></div><button id="template-add">오브젝트 정의 추가</button>`;
  bind("template-add",()=>{const id=value("template-id").trim(),name=value("template-name").trim();if(!id||!name||project.content.traits.some(t=>t.id===id))throw new Error("새 ID와 이름을 입력하세요. 기존 Trait ID는 사용할 수 없습니다.");commit({...project,content:{...project.content,traits:[...project.content.traits,{id,name,source:"cardguild",category:"terrain",description:`${name} 오브젝트`,cardGrants:[],actionGrants:[]}]},presentation:{...project.presentation,objects:[...project.presentation.objects,{id,name,visual:value("template-visual"),interaction:value("template-kind") as "destroy-obstacle"|"open-gate"}]}},"새 오브젝트를 등록했습니다. 맵에서 배치할 수 있습니다.");});
}
render();
// Kept separate from gameplay storage; a local draft cannot resume or mutate a saved campaign.
window.addEventListener("beforeunload",event=>{if(campaignRevision(project)!==initial.baseRevision){event.preventDefault();event.returnValue="";}});
