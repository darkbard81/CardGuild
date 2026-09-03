import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

/**
 * Builds docs/ui-review/index.html from whatever the capture run left on disk.
 * The manifests are inlined so the page opens straight from the filesystem —
 * a fetch() of a sibling JSON file is blocked under file://, an <img src> is not.
 */

const REVIEW_ROOT = path.join("docs", "ui-review");
const STAGES = [
  { id: "baseline", label: "원본", hint: "개선 전 현재 UI" },
  { id: "current", label: "변경", hint: "개선안 재캡쳐" },
] as const;

type Shot = {
  readonly id: string;
  readonly title: string;
  readonly note: string;
  readonly file: string | null;
  readonly skipped?: string;
};

type Manifest = {
  readonly viewport: { readonly id: string; readonly width: number; readonly height: number; readonly label: string };
  readonly capturedAt: string;
  readonly shots: readonly Shot[];
};

type StageId = (typeof STAGES)[number]["id"];

async function readManifests(stage: StageId): Promise<Map<string, Manifest>> {
  const manifests = new Map<string, Manifest>();
  const stageRoot = path.join(REVIEW_ROOT, stage);
  const entries = await readdir(stageRoot, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const file = path.join(stageRoot, entry.name, "manifest.json");
    const raw = await readFile(file, "utf8").catch(() => null);
    if (raw === null) continue;
    manifests.set(entry.name, JSON.parse(raw) as Manifest);
  }
  return manifests;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[character] ?? character));
}

function renderPane(stage: (typeof STAGES)[number], viewportId: string, shot: Shot | undefined): string {
  const source = shot?.file ? `${stage.id}/${viewportId}/${shot.file}` : null;
  const body = source
    ? `<a href="${source}" target="_blank" rel="noreferrer"><img src="${source}" alt="${escapeHtml(stage.label)} ${escapeHtml(shot?.title ?? "")}" loading="lazy" /></a>`
    : `<p class="empty">${escapeHtml(shot?.skipped ?? `아직 ${stage.label} 캡쳐가 없습니다.`)}</p>`;
  return `<figure class="pane" data-stage="${stage.id}">
        <figcaption><span class="stage">${escapeHtml(stage.label)}</span><span class="hint">${escapeHtml(stage.hint)}</span></figcaption>
        ${body}
      </figure>`;
}

function renderViewport(
  viewportId: string,
  manifests: ReadonlyMap<StageId, Map<string, Manifest>>,
): string {
  const perStage = new Map<StageId, Manifest | undefined>(
    STAGES.map((stage) => [stage.id, manifests.get(stage.id)?.get(viewportId)]),
  );
  const reference = perStage.get("baseline") ?? perStage.get("current");
  if (!reference) return "";
  const order: Shot[] = [];
  for (const stage of STAGES) {
    for (const shot of perStage.get(stage.id)?.shots ?? []) {
      if (!order.some((known) => known.id === shot.id)) order.push(shot);
    }
  }
  const captured = STAGES
    .map((stage) => {
      const stamp = perStage.get(stage.id)?.capturedAt;
      return stamp ? `${stage.label} ${stamp.slice(0, 16).replace("T", " ")}` : `${stage.label} 없음`;
    })
    .join(" · ");

  const rows = order.map((shot, index) => {
    const panes = STAGES.map((stage) => {
      const match = perStage.get(stage.id)?.shots.find((candidate) => candidate.id === shot.id);
      return renderPane(stage, viewportId, match);
    }).join("\n      ");
    // The id is prefixed because a viewport like 1440x900 cannot start a CSS selector.
    return `<section class="screen" id="shot-${viewportId}-${shot.id}">
      <header>
        <h3><span class="ordinal">${String(index + 1).padStart(2, "0")}</span>${escapeHtml(shot.title)}</h3>
        <p>${escapeHtml(shot.note)}</p>
        <code>${escapeHtml(shot.id)}</code>
      </header>
      <div class="panes">
      ${panes}
      </div>
    </section>`;
  }).join("\n    ");

  return `<article class="viewport" data-viewport="${viewportId}" hidden>
    <p class="captured">${escapeHtml(reference.viewport.label)} · ${escapeHtml(captured)}</p>
    ${rows}
  </article>`;
}

const manifests = new Map<StageId, Map<string, Manifest>>();
for (const stage of STAGES) manifests.set(stage.id, await readManifests(stage.id));

// Widest first: the desktop pass is the one that carries every screen.
const viewportIds = [...new Set(STAGES.flatMap((stage) => [...(manifests.get(stage.id)?.keys() ?? [])]))]
  .sort((left, right) => Number.parseInt(right, 10) - Number.parseInt(left, 10));
if (viewportIds.length === 0) {
  console.error("No captures found. Run `npm run ui:capture:baseline` first.");
  process.exit(1);
}

const tabs = viewportIds
  .map((id, index) => `<button type="button" data-target="${id}"${index === 0 ? ' class="active"' : ""}>${escapeHtml(id)}</button>`)
  .join("\n      ");

const page = `<!doctype html>
<html lang="ko">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>CardGuild UI/UX 원본 ↔ 변경</title>
<style>
  :root { color-scheme: light dark; --line: #d5d3cd; --muted: #6b6862; --bg: #f6f4ef; --card: #fffdf8; }
  @media (prefers-color-scheme: dark) { :root { --line: #35322c; --muted: #a09a90; --bg: #16150f; --card: #1e1c16; } }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); font: 15px/1.6 ui-sans-serif, system-ui, "Noto Sans KR", sans-serif; }
  header.top { padding: 28px 32px 16px; border-bottom: 1px solid var(--line); }
  h1 { margin: 0 0 6px; font-size: 22px; }
  header.top p { margin: 0; color: var(--muted); max-width: 70ch; }
  nav { display: flex; gap: 8px; padding: 14px 32px; position: sticky; top: 0; background: var(--bg); border-bottom: 1px solid var(--line); z-index: 2; }
  nav button { border: 1px solid var(--line); background: var(--card); color: inherit; border-radius: 999px; padding: 6px 14px; cursor: pointer; font: inherit; }
  nav button.active { background: #3b6ea5; border-color: #3b6ea5; color: #fff; }
  main { padding: 8px 32px 64px; }
  .captured { color: var(--muted); font-size: 13px; margin: 16px 0 8px; }
  .screen { border: 1px solid var(--line); border-radius: 12px; background: var(--card); padding: 18px; margin: 18px 0; }
  .screen header h3 { margin: 0; font-size: 17px; display: flex; gap: 10px; align-items: baseline; }
  .ordinal { color: var(--muted); font-variant-numeric: tabular-nums; }
  .screen header p { margin: 4px 0 6px; color: var(--muted); }
  .screen header code { color: var(--muted); font-size: 12px; }
  .panes { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; margin-top: 14px; }
  @media (max-width: 900px) { .panes { grid-template-columns: 1fr; } }
  figure { margin: 0; }
  figcaption { display: flex; gap: 8px; align-items: baseline; margin-bottom: 6px; }
  .stage { font-weight: 600; }
  .hint { color: var(--muted); font-size: 12px; }
  img { width: 100%; height: auto; display: block; border: 1px solid var(--line); border-radius: 8px; background: #000; }
  .empty { margin: 0; padding: 28px 16px; border: 1px dashed var(--line); border-radius: 8px; color: var(--muted); text-align: center; }
</style>
</head>
<body>
  <header class="top">
    <h1>CardGuild UI/UX — 원본 ↔ 변경</h1>
    <p>화면별 대표 캡쳐입니다. 왼쪽이 개선 전 원본(<code>baseline/</code>), 오른쪽이 개선안 재캡쳐(<code>current/</code>)입니다.
    <code>npm run ui:capture</code>로 오른쪽만 다시 채우고 이 페이지를 새로고침하세요.</p>
  </header>
  <nav>
      ${tabs}
  </nav>
  <main>
    ${viewportIds.map((id) => renderViewport(id, manifests)).join("\n    ")}
  </main>
<script>
  const panels = document.querySelectorAll("article.viewport");
  const buttons = document.querySelectorAll("nav button");
  function show(target) {
    panels.forEach((panel) => { panel.hidden = panel.dataset.viewport !== target; });
    buttons.forEach((button) => { button.classList.toggle("active", button.dataset.target === target); });
  }
  buttons.forEach((button) => button.addEventListener("click", () => show(button.dataset.target)));
  show(buttons[0].dataset.target);
</script>
</body>
</html>
`;

await writeFile(path.join(REVIEW_ROOT, "index.html"), page);
console.log(`Wrote ${path.join(REVIEW_ROOT, "index.html")} for ${viewportIds.join(", ")}.`);
