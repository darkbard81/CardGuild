import { expect, test } from "@playwright/test";
import { controlledSession } from "../support/browser-backend";
import { HERO, lobby } from "../support/session";

test("U-CREATE a late previous Class image cannot replace the current preview", async ({ page }) => {
  const backend = await controlledSession(page, lobby(), "create");
  let release!: () => void;
  const delayed = new Promise<void>(resolve => { release = resolve; });
  const oldImage = "**/assets/actors/human/wizard/male/front.webp";
  await page.route(oldImage, async route => { await delayed; await route.continue(); });
  try {
    const requested = page.waitForRequest(oldImage);
    await page.getByLabel("클래스", { exact: true }).selectOption("human.wizard");
    await requested;
    await page.getByLabel("클래스", { exact: true }).selectOption("human.ranger");
    const loaded = page.waitForResponse(oldImage);
    release();
    await (await loaded).finished();
    const preview = page.getByRole("region", { name: "시작 캐릭터 미리보기" });
    await expect(preview).toHaveAttribute("data-appearance-key", "human.ranger.male");
    await expect(preview.locator(".creation-standee").first()).toHaveCSS("background-image", /human\/ranger\/male\/front.webp/);
    expect(backend.campaigns).toHaveLength(0);
    expect(backend.requests).toHaveLength(0);
  } finally { release(); }
});

test("U-CREATE draft switches preserve name/gender, remain inert and render names as text", async ({ page }) => {
  const backend = await controlledSession(page, lobby(), "create");
  const name = page.getByLabel("캐릭터 이름", { exact: true });
  await name.fill("<b>하늘</b>");
  await page.getByLabel("여성", { exact: true }).check();
  await page.getByLabel("클래스", { exact: true }).selectOption("human.wizard");
  const preview = page.getByRole("region", { name: "시작 캐릭터 미리보기" });
  await expect(preview).toHaveAttribute("data-appearance-key", "human.wizard.female");
  await expect(preview.getByRole("heading")).toHaveText("<b>하늘</b>");
  await expect(preview.locator("b")).toHaveCount(0);
  const statistics = await preview.locator(".creation-statistics").textContent();
  await page.getByLabel("남성", { exact: true }).check();
  await expect(preview.locator(".creation-statistics")).toHaveText(statistics!);
  await page.getByLabel("여성", { exact: true }).check();
  await page.getByLabel("클래스", { exact: true }).selectOption("human.ranger");
  await expect(name).toHaveValue("<b>하늘</b>");
  await expect(page.getByLabel("여성", { exact: true })).toBeChecked();
  await expect(preview).toHaveAttribute("data-appearance-key", "human.ranger.female");
  await expect(page.getByText("시작 장비:", { exact: false })).toContainText("Composite Shortbow");
  await page.getByRole("button", { name: "시작 캐릭터 상세", exact: true }).click();
  const detail = page.getByRole("dialog", { name: "캐릭터 상세", exact: true });
  await expect(detail).toContainText("<b>하늘</b>");
  await expect(detail.locator('[style*="human/ranger/female/front.webp"]').first()).toBeVisible();
  await detail.getByRole("button", { name: "닫기", exact: true }).click();
  expect(backend.requests).toHaveLength(0);
  expect(backend.campaigns).toHaveLength(0);
  await page.getByRole("button", { name: "시작 화면으로", exact: true }).click();
  await expect(page.getByRole("button", { name: "새 모험 시작", exact: true })).toBeVisible();
  expect(backend.requests).toHaveLength(0);
  expect(backend.campaigns).toHaveLength(0);
});

test("U-CREATE reject preserves draft; retry reuses session; ACK plus snapshot gates saved identity", async ({ page }) => {
  const backend = await controlledSession(page, lobby(), "create");
  await page.getByLabel("캐릭터 이름", { exact: true }).fill("하늘");
  await page.getByLabel("여성", { exact: true }).check();
  await page.getByLabel("클래스", { exact: true }).selectOption("human.fighter");
  const confirm = page.getByRole("button", { name: "생성하고 시작", exact: true });
  await confirm.click();
  await expect.poll(() => backend.requests.length).toBe(1);
  expect(backend.requests[0]!.intent).toEqual({ type: "create-character", name: "하늘", gender: "female", creationPresetId: "human.fighter" });
  await expect(confirm).toBeDisabled();
  await expect(page.getByLabel("클래스", { exact: true })).toBeDisabled();
  await page.keyboard.press("Enter");
  expect(backend.requests).toHaveLength(1);
  backend.reject();
  await expect(confirm).toBeEnabled();
  await expect(page.getByRole("status")).toContainText("Saving failed");
  await expect(page.getByLabel("캐릭터 이름", { exact: true })).toHaveValue("하늘");
  await expect(page.getByLabel("여성", { exact: true })).toBeChecked();
  await confirm.click();
  await expect.poll(() => backend.requests.length).toBe(2);
  expect(backend.campaigns).toHaveLength(1);
  const saved = backend.candidate();
  backend.ack(true, saved.revision);
  await expect(confirm).toBeDisabled();
  await expect(page.getByRole("button", { name: "전투 시작", exact: true })).toHaveCount(0);
  backend.publish(saved);
  backend.control({ [HERO]: "host" });
  await expect(page.getByRole("button", { name: "전투 시작", exact: true })).toBeVisible();
  await expect(page.getByRole("list", { name: "Party Level and EXP", exact: true })).toContainText("하늘");
  await page.getByRole("button", { name: "캐릭터 상세", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "캐릭터 상세", exact: true });
  await expect(sheet).toContainText("하늘");
  await expect(sheet.locator('[style*="human/fighter/female/front.webp"]').first()).toBeVisible();
  await sheet.getByRole("button", { name: "닫기", exact: true }).click();
  await page.getByRole("button", { name: "전투 시작", exact: true }).click();
  await page.getByRole("dialog", { name: "미네르바의 첫 전투 안내", exact: true }).getByRole("button", { name: "건너뛰기", exact: true }).click();
  await expect.poll(() => backend.requests.length).toBe(3);
  const combat = backend.candidate();
  backend.publish(combat); backend.ack(true, combat.revision);
  await expect(page.getByRole("region", { name: "Tactical combat", exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("created-fighter-female-combat.png") });
  await expect(page.getByRole("list", { name: "Initiative order", exact: true })).toContainText("하늘");
  await page.getByRole("button", { name: "하늘 상세", exact: true }).click();
  await expect(sheet.locator('[style*="human/fighter/female/front.webp"]').first()).toBeVisible();
});

test("U-CREATE committed snapshot arriving before ACK keeps confirmation locked", async ({ page }) => {
  const backend = await controlledSession(page, lobby(), "create");
  await page.getByLabel("캐릭터 이름", { exact: true }).fill("나래");
  await page.getByLabel("클래스", { exact: true }).selectOption("human.ranger");
  await page.getByRole("button", { name: "생성하고 시작", exact: true }).click();
  await expect.poll(() => backend.requests.length).toBe(1);
  const saved = backend.candidate();
  backend.publish(saved);
  await expect(page.getByRole("button", { name: "생성하고 시작", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "전투 시작", exact: true })).toHaveCount(0);
  backend.ack(true, saved.revision);
  await expect(page.getByRole("button", { name: "전투 시작", exact: true })).toBeVisible();
});

test("U-CREATE expired authentication returns to the same name, gender and Class draft", async ({ page }) => {
  const backend = await controlledSession(page, lobby(), "create");
  let expired = true;
  await page.route("**/api/campaigns", route => {
    if (!expired) return route.fallback();
    expired = false;
    return route.fulfill({ status: 401, json: { code: "UNAUTHENTICATED", message: "Expired" } });
  });
  await page.route("**/api/auth/login", route => route.fulfill({ json: { account: { accountId: "account", username: "Player" } } }));
  await page.getByLabel("캐릭터 이름", { exact: true }).fill("별빛");
  await page.getByLabel("여성", { exact: true }).check();
  await page.getByLabel("클래스", { exact: true }).selectOption("human.wizard");
  await page.getByRole("button", { name: "생성하고 시작", exact: true }).click();
  await expect(page.getByRole("heading", { name: "로그인", exact: true })).toBeVisible();
  await page.getByLabel("계정 이름", { exact: true }).fill("Player");
  await page.getByLabel("비밀번호", { exact: true }).fill("correct-password");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "카드길드에 오신 것을 환영합니다" })).toHaveCount(0);
  await expect(page.getByLabel("캐릭터 이름", { exact: true })).toHaveValue("별빛");
  await expect(page.getByLabel("여성", { exact: true })).toBeChecked();
  await expect(page.getByLabel("클래스", { exact: true })).toHaveValue("human.wizard");
  expect(backend.requests).toHaveLength(0);
  await page.getByRole("button", { name: "생성하고 시작", exact: true }).click();
  await expect.poll(() => backend.requests.length).toBe(1);
  expect(backend.requests[0]!.intent).toMatchObject({ name: "별빛", gender: "female", creationPresetId: "human.wizard" });
});

test("U-CREATE name policy rejects outer whitespace and counts Unicode codepoints before submitting", async ({ page }) => {
  const backend = await controlledSession(page, lobby(), "create");
  const name = page.getByLabel("캐릭터 이름", { exact: true });
  const submit = page.getByRole("button", { name: "생성하고 시작", exact: true });
  for (const invalid of [" padded ", "x".repeat(41), "bad\u200bname"]) {
    await name.fill(invalid); await submit.click();
    await expect(name).toHaveAttribute("aria-invalid", "true");
    expect(backend.campaigns).toHaveLength(0);
  }
  const valid = "🌟".repeat(40);
  await name.fill(valid); await name.press("Enter");
  await expect.poll(() => backend.requests.length).toBe(1);
  expect(backend.requests[0]!.intent).toMatchObject({ name: valid });
});
