import { expect, test } from "@playwright/test";
import { controlledSession } from "../support/browser-backend";
import { act, adventure, HERO, lobby, SECOND } from "../support/session";

for (const order of ["ack-first", "snapshot-first"] as const) {
  test(`U-PREPARE ${order}: comparison/cancel are inert and saving requires ACK plus applied state`, async ({ page }) => {
    const backend = await controlledSession(page);
    await page.getByRole("button", { name: "캐릭터 상세", exact: true }).click();
    const weapon = page.getByRole("button", { name: "장비 해제 비교", exact: true });
    await weapon.click();
    await expect(page.getByRole("region", { name: "선택 항목 비교" })).toBeVisible();
    expect(backend.requests).toHaveLength(0);
    await page.getByRole("button", { name: "비교 취소", exact: true }).click();
    expect(backend.requests).toHaveLength(0);
    await weapon.click();
    await page.getByRole("button", { name: "해제", exact: true }).click();
    await expect.poll(() => backend.requests.length).toBe(1);
    const candidate = backend.candidate();
    const saved = page.getByRole("status").filter({ hasText: "저장됨" });
    if (order === "ack-first") backend.ack(true, candidate.revision);
    else backend.publish(candidate);
    await expect(page.getByRole("button", { name: "닫기", exact: true })).toBeDisabled();
    await expect(saved).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "캐릭터 상세", exact: true })).toBeVisible();
    if (order === "ack-first") backend.publish(candidate);
    else backend.ack(true, candidate.revision);
    await expect(saved).toBeVisible();
    await expect(page.getByRole("button", { name: "주손 · 빈 주손", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "닫기", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "닫기", exact: true }).click();
    await expect(page.getByRole("button", { name: "캐릭터 상세", exact: true })).toBeFocused();
  });
}

test("U-PREPARE rejection permits retry; control loss turns an open comparison read-only", async ({ page }) => {
  const backend = await controlledSession(page);
  await page.getByRole("button", { name: "캐릭터 상세", exact: true }).click();
  await page.getByRole("button", { name: "장비 해제 비교", exact: true }).click();
  await page.getByRole("button", { name: "해제", exact: true }).click();
  await expect.poll(() => backend.requests.length).toBe(1);
  backend.reject();
  await expect(page.getByRole("status").filter({ hasText: "Saving failed. Retry." })).toBeVisible();
  await expect(page.getByRole("button", { name: "해제", exact: true })).toBeEnabled();
  backend.control({ [HERO]: "guest" });
  await expect(page.getByText("읽기 전용 · 다른 플레이어 또는 현재 단계", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "해제", exact: true })).toHaveCount(0);
  expect(backend.requests).toHaveLength(1);
});

test("U-PREPARE dragging equipped gear only opens a comparison; focus survives a control snapshot", async ({ page }) => {
  const backend = await controlledSession(page);
  await page.getByRole("button", { name: "캐릭터 상세", exact: true }).click();
  const handle = page.getByRole("button", { name: "Halberd 끌어서 이동", exact: true });
  const drop = page.getByText("장비함으로 되돌리기 · 장착 장비를 끌어 놓으면 해제를 비교합니다.");
  await handle.dragTo(drop);
  await expect(page.getByRole("button", { name: "해제", exact: true })).toBeEnabled();
  expect(backend.requests).toHaveLength(0);
  const tab = page.getByRole("tab", { name: "카드", exact: true });
  await tab.click();
  backend.control({ [HERO]: "host" });
  await expect(tab).toBeFocused();
  await expect(tab).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: "장비", exact: true }).click();
  const weaponTrait = page.getByRole("dialog", { name: "캐릭터 상세", exact: true }).getByRole("button", { name: "Weapon", exact: true });
  await weaponTrait.focus();
  backend.control({ [HERO]: "host" });
  await expect(weaponTrait).toBeFocused();
  expect(backend.requests).toHaveLength(0);
});

test("U-PREPARE touch long-press reveals readable detail without preparing or removing a card", async ({ page }, testInfo) => {
  await page.clock.install();
  const backend = await controlledSession(page);
  await page.getByRole("button", { name: "캐릭터 상세", exact: true }).click();
  await page.getByRole("tab", { name: "카드", exact: true }).click();
  const card = page.getByRole("button", { name: "Vicious Swing · 준비됨", exact: true });
  const bounds = await card.boundingBox();
  if (!bounds) throw new Error("Prepared card is not visible");
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2, id: 1 }] });
    // Advance the hold gesture's clock; this tests a deliberate duration contract.
    await page.clock.runFor(700);
    await expect(page.getByRole("tooltip")).toBeVisible();
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect(page.getByRole("button", { name: "해제", exact: true })).toHaveCount(0);
    expect(backend.requests).toHaveLength(0);
    const screenshot = testInfo.outputPath("preparation-touch-detail.png");
    await page.screenshot({ path: screenshot });
    await testInfo.attach("preparation-touch-detail", { path: screenshot, contentType: "image/png" });
  } finally { await cdp.detach(); }
});

test("U-PREPARE disconnect during confirmation cannot announce success and permits retry after reconnect", async ({ page }) => {
  const backend = await controlledSession(page);
  await page.getByRole("button", { name: "캐릭터 상세", exact: true }).click();
  await page.getByRole("button", { name: "장비 해제 비교", exact: true }).click();
  await page.getByRole("button", { name: "해제", exact: true }).click();
  await expect.poll(() => backend.requests.length).toBe(1);
  backend.disconnect();
  await expect.poll(() => backend.requests.length).toBe(2);
  expect(backend.requests[1]!.requestId).toBe(backend.requests[0]!.requestId);
  await expect(page.getByRole("status").filter({ hasText: "저장됨" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "해제", exact: true })).toBeDisabled();
  const candidate = backend.candidate();
  backend.ack(true, candidate.revision); backend.publish(candidate);
  await expect(page.getByRole("status").filter({ hasText: "저장됨" })).toBeVisible();
});


test("U-PREPARE slot comparison is inert, committed replacement reaches the sheet and empty slots can be equipped", async ({ page }, testInfo) => {
  const initial = adventure();
  const state = initial.adventure!;
  const backend = await controlledSession(page, { ...initial, adventure: { ...state,
    collection: { ...state.collection, equipment: { ...state.collection.equipment, greatsword: 1 } },
  } });
  await page.getByRole("button", { name: "캐릭터 상세", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "캐릭터 상세", exact: true });
  const weapon = sheet.getByRole("button", { name: "주손 · Halberd", exact: true });
  await expect(weapon).toHaveAttribute("aria-pressed", "true");
  const skills = sheet.getByRole("complementary", { name: "스킬과 지각" });
  await expect(skills.getByText("Athletics", { exact: true })).toBeVisible();
  await expect(skills.getByText("Medicine", { exact: true })).toBeHidden();
  await skills.getByText(/^Untrained \(/).click();
  await expect(skills.getByText("Medicine", { exact: true })).toBeVisible();
  await sheet.getByRole("button", { name: "Greatsword · 비교", exact: true }).click();
  expect(backend.requests).toHaveLength(0);
  await expect(weapon).toBeVisible();
  const apply = sheet.getByRole("button", { name: "교환", exact: true });
  await expect(apply).toBeVisible();
  const box = await apply.boundingBox(); expect(box!.y + box!.height).toBeLessThanOrEqual(768);
  await page.screenshot({ path: testInfo.outputPath("character-equipment-1024.png") });
  await page.setViewportSize({ width: 1448, height: 1086 });
  await page.screenshot({ path: testInfo.outputPath("character-equipment-wide.png") });
  await page.setViewportSize({ width: 1024, height: 768 });
  await apply.click();
  await expect.poll(() => backend.requests.length).toBe(1);
  expect(backend.requests[0]!.intent).toMatchObject({ type: "set-loadout", memberId: HERO, loadout: { equipment: { weapon: "greatsword" } } });
  const changed = backend.candidate(); backend.publish(changed); backend.ack(true, changed.revision);
  await expect(sheet.getByRole("button", { name: "주손 · Greatsword", exact: true })).toBeVisible();
  await sheet.getByRole("button", { name: "장비 해제 비교", exact: true }).click();
  await sheet.getByRole("button", { name: "해제", exact: true }).click();
  await expect.poll(() => backend.requests.length).toBe(2);
  const removed = backend.candidate(); backend.publish(removed); backend.ack(true, removed.revision);
  await expect(sheet.getByRole("button", { name: "주손 · 빈 주손", exact: true })).toBeVisible();
  await sheet.getByRole("button", { name: "Halberd · 비교", exact: true }).click();
  await expect(sheet.getByRole("button", { name: "장착", exact: true })).toBeEnabled();
  await page.keyboard.press("Escape");
  await expect(sheet.getByRole("button", { name: "장착", exact: true })).toHaveCount(0);
  expect(backend.requests).toHaveLength(2);
});

test("U-PREPARE cards distinguish prepared changes from automatic deck sources and explain unavailable choices", async ({ page }, testInfo) => {
  const initial = adventure(); const state = initial.adventure!;
  const backend = await controlledSession(page, { ...initial, adventure: { ...state, collection: { ...state.collection, cards: { ...state.collection.cards, "card.combat-grab": 1, "card.trip": 1, "card.grapple": 1, "card.knockdown": 1 } } } });
  await page.getByRole("button", { name: "캐릭터 상세", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "캐릭터 상세", exact: true });
  await sheet.getByRole("tab", { name: "카드", exact: true }).click();
  await sheet.getByRole("button", { name: "Vicious Swing · 준비됨", exact: true }).click();
  await expect(sheet.getByRole("button", { name: "해제", exact: true })).toBeVisible();
  const preparedRow = sheet.locator(".ui-character-workspace__prepared");
  const preparedBounds = await preparedRow.boundingBox();
  const owned = sheet.locator(".ui-character-workspace__owned");
  await owned.evaluate(node => { node.scrollTop = node.scrollHeight; });
  await expect.poll(() => owned.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
  expect(await preparedRow.boundingBox()).toEqual(preparedBounds);
  expect(await sheet.locator(".ui-character-workspace__card-content").evaluate(node => node.scrollTop)).toBe(0);
  const tabs = await sheet.getByRole("tab", { name: "카드", exact: true }).boundingBox();
  expect(tabs!.height).toBeLessThanOrEqual(36);
  await page.screenshot({ path: testInfo.outputPath("character-cards-1024.png") });
  await sheet.getByRole("button", { name: "해제", exact: true }).click();
  await expect.poll(() => backend.requests.length).toBe(1);
  const removed = backend.candidate(); backend.ack(true, removed.revision); backend.publish(removed);
  await expect(sheet.getByRole("button", { name: "Vicious Swing · 준비됨", exact: true })).toHaveCount(0);
  await sheet.getByRole("button", { name: /^Combat Grab · 보유/ }).click();
  await expect(sheet.getByRole("button", { name: "준비 추가", exact: true })).toBeDisabled();
  await expect(sheet.getByRole("region", { name: "선택 항목 비교" })).toContainText("요구 레벨 2 · 현재 레벨 1");
  await sheet.getByRole("button", { name: /^Vicious Swing · 보유/ }).click();
  await sheet.getByRole("button", { name: "준비 추가", exact: true }).click();
  await expect.poll(() => backend.requests.length).toBe(2);
  const added = backend.candidate(); backend.ack(true, added.revision); backend.publish(added);
  await expect(sheet.getByRole("button", { name: "Vicious Swing · 준비됨", exact: true })).toBeVisible();
  await sheet.getByRole("tab", { name: "전체 덱", exact: true }).click();
  await expect(sheet.getByRole("button", { name: "준비 추가", exact: true })).toHaveCount(0);
  await expect(sheet.getByRole("region", { name: "장비와 카드" })).toContainText("장비 · Halberd");
  await expect(sheet.getByRole("region", { name: "장비와 카드" })).toContainText("준비 카드");
  expect(backend.requests).toHaveLength(2);
});

test("U-PREPARE latest control and inventory govern comparisons; leaving preparation closes the editor", async ({ page }) => {
  const initial = adventure(true); const state = initial.adventure!;
  const backend = await controlledSession(page, { ...initial, adventure: { ...state, collection: { ...state.collection, equipment: { ...state.collection.equipment, greatsword: 1 } } } });
  await page.getByRole("button", { name: "캐릭터 상세", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "캐릭터 상세", exact: true });
  await sheet.getByRole("button", { name: "Greatsword · 비교", exact: true }).click();
  backend.control({ [HERO]: "host", [SECOND]: "guest" });
  await sheet.getByLabel("상세 대상").locator(`[data-actor-id="${SECOND}"]`).click();
  await expect(sheet.getByRole("button", { name: "교환", exact: true })).toHaveCount(0);
  await expect(sheet.getByRole("region", { name: "주손 교체" })).toHaveCount(0);
  await sheet.getByLabel("상세 대상").locator(`[data-actor-id="${HERO}"]`).click();
  await expect(sheet.getByRole("button", { name: "교환", exact: true })).toHaveCount(0);
  await sheet.getByRole("button", { name: "Greatsword · 비교", exact: true }).click();
  backend.publish({ ...backend.state, adventure: { ...backend.state.adventure!, collection: { ...backend.state.adventure!.collection, equipment: { ...backend.state.adventure!.collection.equipment, greatsword: 0 } } } });
  await expect(sheet.getByRole("button", { name: "교환", exact: true })).toBeDisabled();
  await expect(sheet.getByRole("region", { name: "선택 항목 비교" })).toContainText("only 0 are owned");
  backend.publish(act(backend.state, { type: "start-encounter" }));
  await expect(sheet).toHaveCount(0);
  expect(backend.requests).toHaveLength(0);
});

test("U-PREPARE lobby inspection shares the sheet but cannot edit", async ({ page }) => {
  const backend = await controlledSession(page, lobby());
  await page.getByRole("button", { name: "Aerin 상세", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "캐릭터 상세", exact: true });
  await expect(sheet.getByRole("button", { name: "주손 · Halberd", exact: true })).toBeVisible();
  await expect(sheet.getByRole("region", { name: "주손 교체" })).toHaveCount(0);
  await sheet.getByRole("tab", { name: "카드", exact: true }).click();
  await expect(sheet.getByRole("tab", { name: "전체 덱", exact: true })).toHaveAttribute("aria-selected", "true");
  expect(backend.requests).toHaveLength(0);
});


test("U-PREPARE reward entry selects its slot and filter; invalid and cancelled drags never create a change", async ({ page }) => {
  const initial = adventure(); const state = initial.adventure!;
  const backend = await controlledSession(page, { ...initial, adventure: { ...state, collection: { ...state.collection, equipment: { ...state.collection.equipment, greatsword: 1 } } } });
  await page.getByRole("button", { name: "보상 확인", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "캐릭터 상세", exact: true });
  await expect(sheet.getByRole("region", { name: "주손 교체", exact: true })).toBeVisible();
  await expect(sheet.getByRole("button", { name: "보상 필터 해제", exact: true })).toBeVisible();
  const handle = sheet.getByRole("button", { name: "Greatsword 끌어서 이동", exact: true });
  const weapon = sheet.getByRole("button", { name: "주손 · Halberd", exact: true });
  await handle.dragTo(sheet.getByRole("button", { name: "몸 · Scale Mail", exact: true }));
  await expect(sheet.getByRole("status")).toContainText("이 위치에는 놓을 수 없습니다");
  await expect(sheet.getByRole("button", { name: "교환", exact: true })).toHaveCount(0);
  const start = await handle.boundingBox(); const target = await weapon.boundingBox();
  await page.mouse.move(start!.x + start!.width / 2, start!.y + start!.height / 2); await page.mouse.down();
  await page.mouse.move(target!.x + target!.width / 2, target!.y + target!.height / 2, { steps: 4 });
  await page.keyboard.press("Escape"); await page.mouse.up();
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("button", { name: "교환", exact: true })).toHaveCount(0);
  await page.mouse.move(start!.x + start!.width / 2, start!.y + start!.height / 2); await page.mouse.down();
  await page.mouse.move(target!.x + target!.width / 2, target!.y + target!.height / 2, { steps: 4 });
  await handle.dispatchEvent("pointercancel"); await page.mouse.up();
  await expect(sheet.getByRole("button", { name: "교환", exact: true })).toHaveCount(0);
  await handle.dragTo(weapon);
  await expect(sheet.getByRole("button", { name: "교환", exact: true })).toBeEnabled();
  expect(backend.requests).toHaveLength(0);
  await sheet.getByRole("button", { name: "비교 취소", exact: true }).click();
  await sheet.getByRole("button", { name: "보상 필터 해제", exact: true }).click();
  await expect(sheet.getByRole("button", { name: "보상 필터 해제", exact: true })).toHaveCount(0);
});
