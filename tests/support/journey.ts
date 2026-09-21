import { test as base, expect, type Page } from "@playwright/test";
import { productProcess } from "./process";
import { PASSWORD, Wire } from "./network";
import type { SessionCredentialResponse } from "../../src/server/session-store";

export const test = base.extend<{ server: Awaited<ReturnType<typeof productProcess>> }>({
  // Playwright requires destructuring even when there are no fixture dependencies.
  // eslint-disable-next-line no-empty-pattern
  server: async ({}, use, info) => {
    const server = await productProcess();
    try { await server.start(); await use(server); }
    finally {
      await server.dispose();
      if (info.status !== info.expectedStatus) await info.attach("server-seed-60", { body: server.log, contentType: "text/plain" });
    }
  },
});
export { expect };

export async function signIn(page: Page, origin: string, username = "journey-player") {
  await page.goto(origin);
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await page.getByLabel("계정 이름", { exact: true }).fill(username);
  await page.getByLabel("비밀번호", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page.getByRole("button", { name: "로그아웃", exact: true })).toBeVisible();
}

export async function newAdventure(page: Page, origin: string, two = false) {
  await page.goto(origin);
  await page.getByRole("button", { name: "새 모험 시작", exact: true }).click();
  await page.getByRole("button", { name: "계정 만들기", exact: true }).click();
  await page.getByLabel("계정 이름", { exact: true }).fill("journey-player");
  await page.getByLabel("비밀번호", { exact: true }).fill(PASSWORD);
  await page.getByLabel("비밀번호 확인", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "계정 만들기", exact: true }).click();
  await expect(page.getByRole("heading", { name: "캐릭터 생성", exact: true })).toBeVisible();
  if (two) {
    // Recruitment/preparation co-op belongs to #65/#66. Preserve the authored 2P
    // precondition for J-COOP while exercising its real guest join/control UI.
    const response = await page.request.post(`${origin}/api/campaigns`, { data: { name: "Journey campaign", displayName: "Host" } });
    expect(response.ok()).toBe(true);
    const credential = await response.json() as SessionCredentialResponse;
    const wire = await Wire.open(origin, credential);
    try {
      await wire.snapshot();
      await wire.intent({ type: "set-party-composition", actorDefinitionIds: ["hero.aerin", "hero.lyra"] });
    } finally { await wire.close(); }
    await page.evaluate(value => sessionStorage.setItem("cardguild.session.v2", JSON.stringify(value)), credential);
    await page.reload();
    await expect(page.locator("#invite-session-id")).toBeVisible();
    return;
  }
  await page.getByLabel("캐릭터 이름", { exact: true }).fill("Aerin");
  await page.getByLabel("클래스", { exact: true }).selectOption("human.fighter");
  await page.getByRole("button", { name: "생성하고 시작", exact: true }).click();
  await expect(page.getByRole("button", { name: "전투 시작", exact: true })).toBeVisible();
}

export async function beginBattle(page: Page) {
  await page.getByRole("button", { name: "전투 시작", exact: true }).click();
  await expect(page.getByRole("region", { name: "Tactical combat", exact: true })).toBeVisible();
}

export async function stepToCenter(page: Page) {
  await expect(page.getByRole("button", { name: "End Turn", exact: true })).toBeEnabled();
  await page.mouse.click(379, 446);
  await page.getByRole("menu", { name: "Tile 1,1", exact: true }).getByRole("menuitem", { name: /Step/ }).click();
  await page.getByText("Combat Log", { exact: true }).click();
  await expect(page.locator("#combat-log")).toContainText("Aerin used Step");
}

export async function endTurn(page: Page) {
  await page.getByRole("button", { name: "End Turn", exact: true }).click();
  await page.getByRole("button", { name: "턴 종료", exact: true }).click();
  await expect(page.locator("#board-prompt")).toContainText("턴을 마칠 때");
  await page.mouse.click(499, 504);
}
