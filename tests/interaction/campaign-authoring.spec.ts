import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import type { CampaignProject } from "../../src/authoring/types";

test("U-AUTHOR scopes encounter choices, linking and progress order to the selected campaign after switching and importing", async ({ page }) => {
  await page.goto("/campaign-editor.html");
  const campaignId = "adventure.recruitment-tutorial";
  const campaignName = "동료 합류 Tutorial 연결";
  const source = JSON.parse(await page.locator("#project-json").inputValue()) as CampaignProject;
  // Reordering is legal here: no mandatory recruitment reward constrains the final stage.
  const original = { ...source, content: { ...source.content, adventures: source.content.adventures.map(a => a.id === campaignId ? { ...a, rewards: [] } : a) } };
  await page.getByLabel("JSON 불러오기", { exact: true }).setInputFiles({ name: "campaign-order.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(original)) });
  await expect(page.getByRole("status")).toContainText("불러왔습니다");
  const encounterSelect = page.getByLabel("인카운터", { exact: true });
  const choices = () => encounterSelect.locator("option").evaluateAll(options => options.map(option => (option as HTMLOptionElement).value));
  await page.getByLabel("편집 캠페인", { exact: true }).selectOption(campaignId);
  const campaign = page.getByRole("region", { name: campaignName, exact: true });
  await expect(campaign.getByRole("heading", { name: "인카운터 연결", exact: true })).toBeVisible();
  const order = campaign.getByRole("navigation", { name: `${campaignName} 진행 순서`, exact: true });
  expect(await choices()).toEqual(["encounter.road-ambush", "encounter.spear-line"]);
  await expect(encounterSelect).toHaveValue("encounter.road-ambush");
  await expect(order.getByRole("button", { name: "위로", exact: true })).toBeDisabled();
  await encounterSelect.selectOption("encounter.spear-line");
  await order.getByRole("button", { name: "위로", exact: true }).click();
  expect(await choices()).toEqual(["encounter.spear-line", "encounter.road-ambush"]);
  await expect(order.locator("[aria-current=step]")).toHaveText(original.content.scenarios.find(s => s.id === "encounter.spear-line")!.name);
  await expect(page.getByLabel("편집 경로", { exact: true })).toContainText(`${campaignName} › 1.`);
  const reordered = JSON.parse(await page.locator("#project-json").inputValue()) as CampaignProject;
  expect(reordered.content.adventures.filter(a => a.id !== campaignId).map(a => a.encounterIds))
    .toEqual(original.content.adventures.filter(a => a.id !== campaignId).map(a => a.encounterIds));

  // The previous encounter still exists globally, but the imported campaign no longer links it.
  const imported = { ...original, content: { ...original.content, adventures: original.content.adventures.map(a => a.id !== campaignId ? a : {
    ...a, encounterIds: ["encounter.road-ambush"], experienceAwards: a.experienceAwards.filter(award => award.afterEncounterId === "encounter.road-ambush"),
  }) } };
  await page.getByLabel("JSON 불러오기", { exact: true }).setInputFiles({ name: "scoped.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(imported)) });
  await expect(page.getByRole("status")).toContainText("불러왔습니다");
  expect(await choices()).toEqual(["encounter.road-ambush"]);
  await expect(encounterSelect).toHaveValue("encounter.road-ambush");
  await expect(order.getByRole("button", { name: "아래로", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "실행 취소", exact: true }).click();
  expect(await choices()).toEqual(["encounter.spear-line", "encounter.road-ambush"]);
  await page.getByLabel("편집 캠페인", { exact: true }).selectOption("adventure.willowbrook");
  expect(await choices()).toEqual(original.content.adventures.find(a => a.id === "adventure.willowbrook")!.encounterIds);
  await expect(encounterSelect).toHaveValue("encounter.guild-practice");
});

test("U-AUTHOR edits height, registers and places a new object, preserves invalid-import drafts and exports for Codex", async ({ page }, info) => {
  await page.goto("/campaign-editor.html");
  await expect(page.getByRole("heading", { name: "캠페인 제작", exact: true })).toBeVisible();
  const status = page.getByRole("status");
  await page.getByLabel("높이", { exact: true }).fill("4");
  await page.getByRole("button", { name: "높이 적용", exact: true }).click();
  await expect(status).toContainText("높이를 저장");
  await page.getByRole("button", { name: "실행 취소", exact: true }).click();
  await expect(page.getByLabel("높이", { exact: true })).toHaveValue("3");
  await page.getByRole("button", { name: "다시 실행", exact: true }).click();
  await expect(page.getByLabel("높이", { exact: true })).toHaveValue("4");
  await page.getByRole("button", { name: "오브젝트", exact: true }).click();
  await page.getByLabel("오브젝트 ID", { exact: true }).fill("authoring-crate");
  await page.getByLabel("이름", { exact: true }).fill("보급 상자");
  await page.getByRole("button", { name: "오브젝트 정의 추가", exact: true }).click();
  await expect(status).toContainText("새 오브젝트");
  await page.getByRole("button", { name: "맵", exact: true }).click();
  await page.getByLabel("오브젝트", { exact: true }).selectOption("authoring-crate");
  await page.getByRole("button", { name: "오브젝트 배치", exact: true }).click();
  await expect(status).toContainText("배치했습니다");
  await expect(page.getByRole("gridcell", { name: "타일 0,0", exact: true })).toContainText("◆");
  await page.getByLabel("JSON 불러오기", { exact: true }).setInputFiles({ name: "bad.json", mimeType: "application/json", buffer: Buffer.from('{"version":2}') });
  await expect(status).toHaveClass(/error/);
  await expect(page.getByRole("gridcell", { name: "타일 0,0", exact: true })).toContainText("◆");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "JSON 내보내기", exact: true }).click();
  const artifact = await download;
  const project = JSON.parse(await readFile((await artifact.path())!, "utf8")) as CampaignProject;
  expect(project.presentation.elevations.maps["encounter.willow-rescue"]![0]).toBe(4);
  expect(project.presentation.objects.find(o => o.id === "authoring-crate")?.visual).toBe("object.chest");
  expect(project.content.scenarios.find(s => s.id === "encounter.willow-rescue")!.map.objects.some(o => o.traits.some(t => t.id === "authoring-crate"))).toBe(true);
  page.on("dialog", dialog => dialog.accept());
  await page.reload();
  await page.getByRole("button", { name: "저장한 초안 복원", exact: true }).click();
  await expect(page.getByRole("gridcell", { name: "타일 0,0", exact: true })).toContainText("◆");
  await page.screenshot({ path: info.outputPath("campaign-map.png") });
});

test("U-AUTHOR edits dialogue and rewards, previews the saved line and duplicates an encounter into campaign order", async ({ page }, info) => {
  await page.goto("/campaign-editor.html");
  await page.getByRole("button", { name: "다이얼로그", exact: true }).click();
  await page.getByLabel("대사 본문", { exact: true }).fill("주민들을 위해 새 길을 열어주세요.");
  await page.getByRole("button", { name: "대사 저장", exact: true }).click();
  await page.getByRole("button", { name: "재생 미리보기", exact: true }).click();
  const dialogue = page.getByRole("dialog", { name: "대사 미리보기", exact: true });
  await expect(dialogue).toContainText("주민들을 위해 새 길을 열어주세요.");
  await page.keyboard.press("Escape");
  await expect(dialogue).toHaveCount(0);
  await page.getByRole("button", { name: "보상", exact: true }).click();
  await page.getByLabel("경험치", { exact: true }).fill("125");
  await page.getByLabel("종류", { exact: true }).selectOption("card");
  await page.getByLabel("정의", { exact: true }).selectOption("card.shield-spell");
  await page.getByRole("button", { name: "선택 항목 추가", exact: true }).click();
  await page.getByRole("button", { name: "보상·경험치 저장", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("캠페인 초안");
  await page.screenshot({ path: info.outputPath("campaign-reward.png") });
  await page.getByText("인카운터 복제", { exact: true }).click();
  await page.getByLabel("새 인카운터 ID", { exact: true }).fill("encounter.authoring-copy");
  await page.getByLabel("새 인카운터 이름", { exact: true }).fill("새 숲길");
  await page.getByRole("button", { name: "현재 전장 복제·연결", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("복제하고");
  await page.getByRole("button", { name: "검증", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("검증 통과");
  await page.getByText("전체 프로젝트 JSON", { exact: true }).click();
  const project = JSON.parse(await page.locator("#project-json").inputValue()) as CampaignProject;
  const campaign = project.content.adventures.find(a => a.id === "adventure.willowbrook")!;
  expect(campaign.encounterIds.at(-1)).toBe("encounter.authoring-copy");
  expect(campaign.experienceAwards.find(a => a.afterEncounterId === "encounter.willow-rescue")?.amount).toBe(125);
  expect(campaign.rewards.find(r => r.afterEncounterId === "encounter.willow-rescue")!.choices).toContainEqual({ kind: "card", definitionId: "card.shield-spell" });
  expect(project.dialogue.scenes["encounter.authoring-copy.briefing"]!.lines[0]!.text).toContain("새 길");
});

test("U-AUTHOR structured encounter forms reject a blocked placement, retain the draft and edit targets and party spawns", async ({ page }) => {
  await page.goto("/campaign-editor.html");
  await page.getByRole("button", { name: "인카운터", exact: true }).click();
  await page.getByLabel("적 인스턴스 ID", { exact: true }).fill("editor-enemy");
  await page.getByLabel("적 정의", { exact: true }).selectOption("enemy.dark-elf-warrior");
  await page.getByLabel("적 X", { exact: true }).fill("1");
  await page.getByLabel("적 Y", { exact: true }).fill("2");
  await page.getByRole("button", { name: "적 배치 저장", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("ACTOR_TILE_BLOCKED");
  await expect(page.getByLabel("적 인스턴스 ID", { exact: true })).toHaveValue("editor-enemy");
  await page.getByLabel("적 X", { exact: true }).fill("0");
  await page.getByRole("button", { name: "적 배치 저장", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("인카운터 초안");
  await page.getByLabel("승리 방식", { exact: true }).selectOption("resolve-objectives");
  await page.getByText("필수 목표 선택", { exact: true }).click();
  await page.getByLabel("editor-enemy", { exact: true }).check();
  await page.getByRole("button", { name: "이름·목표 저장", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("인카운터 초안");
  await page.getByLabel("1번 Y", { exact: true }).fill("18");
  await page.getByRole("button", { name: "시작 위치 저장", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("인카운터 초안");
  await page.getByText("전체 프로젝트 JSON", { exact: true }).click();
  const project = JSON.parse(await page.locator("#project-json").inputValue()) as CampaignProject;
  const encounter = project.content.scenarios.find(s => s.id === "encounter.willow-rescue")!;
  expect(encounter.rules?.victory?.enemyIds).toEqual(["editor-enemy"]);
  expect(encounter.placements.find(p => p.instanceId === "editor-enemy")?.position).toEqual({ x: 0, y: 2 });
  expect(encounter.partySpawnSlots[0]!.position).toEqual({ x: 9, y: 18 });
});

test("U-AUTHOR renders a new draft encounter with its custom object and heights, changes party size and reopens cleanly", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/campaign-editor.html");
  await page.getByText("전체 프로젝트 JSON", { exact: true }).click();
  const original = JSON.parse(await page.locator("#project-json").inputValue()) as CampaignProject;
  const source = original.content.scenarios.find(s => s.id === "encounter.guild-practice")!;
  const id = "encounter.preview-draft";
  const draft = { ...original, content: { ...original.content,
    traits: [...original.content.traits, { id: "preview-crate", name: "새 상자", source: "cardguild", category: "terrain", description: "편집 초안", cardGrants: [], actionGrants: [] }],
    scenarios: [...original.content.scenarios, { ...source, id, name: "초안 전장",
      placements: [...source.placements, { ...source.placements[0]!, instanceId: "extra-enemy", position: { x: 2, y: 0 }, partySize: { min: 2, max: 3 } }],
      map: { ...source.map, tiles: source.map.tiles.map(t => t.position.x === 1 && t.position.y === 2 ? { ...t, traits: [{ id: "blocked" }, { id: "obstacle" }] } : t),
        objects: [{ id: "draft-crate", name: "새 상자", position: { x: 1, y: 2 }, traits: [{ id: "preview-crate" }], used: false,
          interaction: { kind: "destroy-obstacle", targetTileId: source.map.tiles.find(t => t.position.x === 1 && t.position.y === 2)!.id } }] } }],
  }, presentation: { ...original.presentation, objects: [...original.presentation.objects,
    { id: "preview-crate", name: "새 상자", visual: "object.chest", interaction: "destroy-obstacle" }],
    elevations: { version: 1, maps: { ...original.presentation.elevations.maps, [id]: [0,0,0,0,0,0,0,2,0] } } } };
  await page.getByLabel("JSON 불러오기", { exact: true }).setInputFiles({ name: "preview.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(draft)) });
  await expect(page.getByRole("status")).toContainText("불러왔습니다");
  await expect(page.getByLabel("인카운터", { exact: true }).locator(`option[value="${id}"]`)).toHaveCount(0);
  await page.getByText("미연결 인카운터 추가", { exact: true }).click();
  await page.getByLabel("연결할 인카운터", { exact: true }).selectOption(id);
  await page.getByRole("button", { name: "이 캠페인에 연결", exact: true }).click();
  await expect(page.getByLabel("인카운터", { exact: true })).toHaveValue(id);
  await page.getByRole("button", { name: "실행 취소", exact: true }).click();
  await expect(page.getByLabel("인카운터", { exact: true })).toHaveValue("encounter.guild-practice");
  await page.getByRole("button", { name: "다시 실행", exact: true }).click();
  await page.getByLabel("인카운터", { exact: true }).selectOption(id);
  await page.getByRole("button", { name: "전장 미리보기", exact: true }).click();
  const preview = page.frameLocator('iframe[title="초안 전장"]');
  await expect(preview.getByRole("status")).toContainText("초안 전장 · 아군 1명 · 적 1명 · 오브젝트 1개");
  await expect(preview.locator("canvas")).toBeVisible();
  await preview.getByLabel("미리보기 파티 인원").selectOption("3");
  await expect(preview.getByRole("status")).toContainText("아군 3명 · 적 2명");
  await expect(preview.getByRole("alert", { includeHidden: true })).toBeEmpty();
  await preview.locator("canvas").click({ position: { x: 410, y: 350 } });
  await expect(preview.locator("#preview-selection")).toContainText("선택 1,2 · 높이 2");
  await page.screenshot({ path: info.outputPath("campaign-battle-preview.png") });
  await page.getByRole("button", { name: "전장 미리보기 닫기", exact: true }).click();
  await expect(page.locator("iframe")).toHaveCount(0);
  await page.getByRole("button", { name: "전장 미리보기", exact: true }).click();
  await expect(preview.getByRole("status")).toContainText("아군 1명 · 적 1명");
  await page.getByRole("button", { name: "전장 미리보기 닫기", exact: true }).click();
  await expect(page.getByRole("button", { name: "전장 미리보기", exact: true })).toBeFocused();
  expect(errors).toEqual([]);
});

test("U-AUTHOR creates and switches to an independent campaign, edits its name and undoes creation", async ({ page }) => {
  await page.goto("/campaign-editor.html");
  await page.getByText("새 캠페인 만들기", { exact: true }).click();
  await page.getByLabel("새 캠페인 ID", { exact: true }).fill("adventure.new-story");
  await page.getByLabel("새 캠페인 이름", { exact: true }).fill("새 모험");
  await page.getByRole("button", { name: "캠페인 복제 생성", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("새 캠페인을 만들었습니다");
  await expect(page.getByLabel("편집 캠페인", { exact: true })).toHaveValue("adventure.new-story");
  await expect(page.getByLabel("인카운터", { exact: true })).toHaveValue("adventure.new-story.encounter-1");
  await page.getByRole("button", { name: "이 캠페인을 기본 실행으로 지정", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("기본 실행 캠페인을 지정");
  await page.getByText("전체 프로젝트 JSON", { exact: true }).click();
  const selectedProject = JSON.parse(await page.locator("#project-json").inputValue()) as CampaignProject;
  expect(selectedProject.activeAdventureId).toBe("adventure.new-story");
  expect(selectedProject.authoredAdventureIds).toContain("adventure.new-story");
  await page.getByText("캠페인 설정", { exact: true }).click();
  await page.getByLabel("캠페인 이름", { exact: true }).fill("나만의 모험");
  await page.getByRole("button", { name: "캠페인 저장", exact: true }).click();
  await page.getByLabel("편집 캠페인", { exact: true }).selectOption("adventure.willowbrook");
  await page.getByText("캠페인 설정", { exact: true }).click();
  await expect(page.getByLabel("캠페인 이름", { exact: true })).toHaveValue("Aerin과 윌로우브룩");
  await page.getByRole("button", { name: "실행 취소", exact: true }).click();
  await page.getByRole("button", { name: "실행 취소", exact: true }).click();
  await page.getByRole("button", { name: "실행 취소", exact: true }).click();
  await expect(page.getByLabel("편집 캠페인", { exact: true }).locator('option[value="adventure.new-story"]')).toHaveCount(0);
});
