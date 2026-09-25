import { joinSessionCore } from "../../src/session";
import { expect, test } from "@playwright/test";
import { controlledSession } from "../support/browser-backend";
import { act, adventure, context, lobby, SECOND } from "../support/session";

const title = "카드길드에 오신 것을 환영합니다";

test("U-SCENE pages, expressions, keyboard and duplicate input reach creation without creating a campaign", async ({ page }) => {
  const backend = await controlledSession(page, lobby(), "create", "host", "show");
  const scene = page.getByRole("dialog", { name: title });
  await expect(scene).toContainText("저는 길드 접수원 미네르바예요.");
  await expect(scene.getByRole("img")).toHaveAttribute("data-expression", "welcome");
  await expect(page.getByLabel("캐릭터 이름", { exact: true })).toHaveCount(0);
  await expect(scene.getByRole("button", { name: "다음", exact: true })).toBeFocused();
  await page.screenshot({ path: test.info().outputPath("minerva-welcome.png") });
  await scene.getByRole("button", { name: "다음", exact: true }).dblclick();
  await expect(scene.getByRole("img")).toHaveAttribute("data-expression", "explain");
  await expect(scene).toContainText("이름과 성별");
  await page.keyboard.down("Enter");
  await page.keyboard.down("Enter");
  await page.keyboard.up("Enter");
  await expect(scene.getByRole("img")).toHaveAttribute("data-expression", "cheer");
  await scene.getByRole("button", { name: "캐릭터 만들기", exact: true }).click();
  await expect(scene).toHaveCount(0);
  await expect(page.getByLabel("캐릭터 이름", { exact: true })).toBeFocused();
  expect(backend.campaigns).toHaveLength(0);
  expect(backend.requests).toHaveLength(0);
});

test("U-SCENE cancel, Escape and a fresh explicit attempt replay welcome; skip is inert", async ({ page }) => {
  const backend = await controlledSession(page, lobby(), "create", "host", "show");
  const scene = page.getByRole("dialog", { name: title });
  for (const cancel of ["button", "escape"]) {
    if (cancel === "button") await scene.getByRole("button", { name: "돌아가기", exact: true }).click();
    else await page.keyboard.press("Escape");
    await expect(scene).toHaveCount(0);
    await expect(page.getByRole("button", { name: "새 모험 시작", exact: true })).toBeFocused();
    await page.getByRole("button", { name: "새 모험 시작", exact: true }).click();
    await expect(scene.getByRole("img")).toHaveAttribute("data-expression", "welcome");
  }
  await scene.getByRole("button", { name: "건너뛰기", exact: true }).click();
  await expect(page.getByLabel("캐릭터 이름", { exact: true })).toBeFocused();
  expect(backend.campaigns).toHaveLength(0);
  await page.getByRole("button", { name: "시작 화면으로", exact: true }).click();
  await page.getByRole("button", { name: "새 모험 시작", exact: true }).click();
  await expect(scene.getByRole("img")).toHaveAttribute("data-expression", "welcome");
});

test.describe("touch", () => {
  test.use({ hasTouch: true });
  test("U-SCENE touch advances and completes at narrow width", async ({ page }) => {
    await page.setViewportSize({ width: 600, height: 768 });
    const backend = await controlledSession(page, lobby(), "create", "host", "show");
    const scene = page.getByRole("dialog", { name: title });
    await expect(scene).toBeVisible();
    const bounds = await scene.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(600);
    await scene.getByRole("button", { name: "다음", exact: true }).tap();
    await expect(scene.getByRole("img")).toHaveAttribute("data-expression", "explain");
    await scene.getByRole("button", { name: "다음", exact: true }).tap();
    await expect(scene.getByRole("img")).toHaveAttribute("data-expression", "cheer");
    await scene.getByRole("button", { name: "캐릭터 만들기", exact: true }).tap();
    await expect(page.getByLabel("캐릭터 이름", { exact: true })).toBeVisible();
    expect(backend.campaigns).toHaveLength(0);
  });
});

test("U-SCENE Guest entry has no welcome", async ({ page }) => {
  const shared = act(adventure(true), { type: "set-coop-allowed", memberIds: [SECOND], revokeGuests: false });
  const joined = joinSessionCore(shared, { playerId: "guest", displayName: "Guest" }, context);
  if (!joined.accepted) throw new Error(joined.error);
  await controlledSession(page, joined.state, "join", "guest");
  await expect(page.getByRole("dialog", { name: title })).toHaveCount(0);
});

test("U-SCENE first battle briefing cancels to preparation and skips only once across departure retry", async ({ page }) => {
  const backend = await controlledSession(page);
  const start = page.getByRole("button", { name: "전투 시작", exact: true });
  const scene = page.getByRole("dialog", { name: "미네르바의 첫 전투 안내", exact: true });
  await start.click();
  await expect(scene).toContainText("슬라임");
  expect(backend.requests).toHaveLength(0);
  await page.keyboard.press("Escape");
  await expect(scene).toHaveCount(0);
  await expect(start).toBeFocused();
  await start.click();
  await expect(scene.getByRole("img")).toHaveAttribute("data-expression", "welcome");
  await scene.getByRole("button", { name: "건너뛰기", exact: true }).click();
  await expect.poll(() => backend.requests.length).toBe(1);
  expect(backend.requests[0]!.intent.type).toBe("start-encounter");
  await start.click();
  expect(backend.requests).toHaveLength(1);
  backend.reject();
  await expect(page.getByRole("region", { name: "Adventure Progress", exact: true }).getByRole("alert")).toBeVisible();
  await start.click();
  await expect.poll(() => backend.requests.length).toBe(2);
  await expect(scene).toHaveCount(0);
});

test("U-SCENE first battle briefing cannot send a stale departure after session retirement", async ({ page }) => {
  const backend = await controlledSession(page);
  await page.getByRole("button", { name: "전투 시작", exact: true }).click();
  const scene = page.getByRole("dialog", { name: "미네르바의 첫 전투 안내", exact: true });
  await expect(scene).toBeVisible();
  backend.terminal();
  await expect(scene).toHaveCount(0);
  await expect(page.getByRole("button", { name: "새 모험 시작", exact: true })).toBeVisible();
  expect(backend.requests).toHaveLength(0);
});

test("U-SCENE first battle completion explains protection before a single departure", async ({ page }) => {
  const backend = await controlledSession(page);
  await page.getByRole("button", { name: "전투 시작", exact: true }).click();
  const scene = page.getByRole("dialog", { name: "미네르바의 첫 전투 안내", exact: true });
  await scene.getByRole("button", { name: "다음", exact: true }).click();
  await expect(scene).toContainText("공격 카드 한 장");
  await scene.getByRole("button", { name: "다음", exact: true }).click();
  await expect(scene).toContainText("행동을 세 번");
  await scene.getByRole("button", { name: "다음", exact: true }).click();
  await expect(scene).toContainText("HP가 1보다 낮아지지 않아요");
  await expect(scene.getByRole("img")).toHaveAttribute("data-expression", "firm");
  await scene.getByRole("button", { name: "다음", exact: true }).click();
  expect(backend.requests).toHaveLength(0);
  await scene.getByRole("button", { name: "연습 전투 시작", exact: true }).click();
  await expect.poll(() => backend.requests.length).toBe(1);
  await expect(scene).toHaveCount(0);
});
