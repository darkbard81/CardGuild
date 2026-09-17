import { test as base, expect, type Page } from "@playwright/test";
import { productProcess } from "./process";
import { PASSWORD } from "./network";

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
  await page.getByLabel("모험 이름", { exact: true }).fill("Journey campaign");
  await page.getByLabel("표시 이름 (선택)", { exact: true }).fill("Host");
  await page.getByRole("button", { name: "모험 만들기", exact: true }).click();
  await page.getByRole("button", { name: "동료 2 비우기", exact: true }).click();
  await page.getByRole("button", { name: "동료 1 비우기", exact: true }).click();
  const aerin = page.getByRole("article").filter({ has: page.getByRole("heading", { name: "Aerin", exact: true }) });
  await aerin.getByRole("button", { name: /파티에 선택됨|이 슬롯에 선택/ }).click();
  if (two) {
    await page.getByRole("button", { name: "동료 1 · 비어 있음", exact: true }).click();
    await page.getByRole("article").filter({ has: page.getByRole("heading", { name: "Lyra", exact: true }) }).getByRole("button", { name: "이 슬롯에 선택", exact: true }).click();
  }
  await page.getByRole("button", { name: "파티 적용", exact: true }).click();
  await expect(page.getByRole("button", { name: "파티 적용됨", exact: true })).toBeVisible();
}

export async function beginBattle(page: Page) {
  await page.getByRole("button", { name: "모험 시작", exact: true }).click();
  await page.getByRole("button", { name: "전투 시작", exact: true }).click();
  await expect(page.getByRole("region", { name: "Tactical combat", exact: true })).toBeVisible();
}

export async function stepToCenter(page: Page) {
  await expect(page.getByRole("button", { name: "End Turn", exact: true })).toBeEnabled();
  await page.mouse.click(342, 354);
  await page.getByRole("menu", { name: "Tile 1,1", exact: true }).getByRole("menuitem", { name: /Step/ }).click();
  await page.getByText("Combat Log", { exact: true }).click();
  await expect(page.locator("#combat-log")).toContainText("Aerin used Step");
}

export async function endTurn(page: Page) {
  await page.getByRole("button", { name: "End Turn", exact: true }).click();
  await page.getByRole("button", { name: "턴 종료", exact: true }).click();
  await expect(page.locator("#board-prompt")).toContainText("턴을 마칠 때");
  await page.mouse.click(550, 350);
}
