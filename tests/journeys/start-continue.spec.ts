import { test, expect, newAdventure, beginBattle, stepToCenter, signIn, endTurn } from "../support/journey";

test("J-START first entry, authentication, solo character creation and the first real combat action", async ({ page, server }) => {
  await newAdventure(page, server.origin);
  await beginBattle(page);
  await stepToCenter(page);
});

test("J-CONTINUE approved progress survives server restart and a fresh browser can Resume and act", async ({ page, browser, server }) => {
  await newAdventure(page, server.origin);
  await beginBattle(page);
  await stepToCenter(page);
  await page.close();
  await server.stop("SIGKILL");
  await server.start();
  const freshContext = await browser.newContext({ viewport: { width: 1024, height: 768 } });
  try {
    const fresh = await freshContext.newPage();
    await signIn(fresh, server.origin);
    await fresh.getByRole("button", { name: "이어하기", exact: true }).click();
    await expect(fresh.getByRole("heading", { name: "Aerin의 모험", exact: true })).toBeVisible();
    await fresh.getByRole("button", { name: "이어하기", exact: true }).click();
    await expect(fresh.getByRole("heading", { name: "모험 이어가기 준비", exact: true })).toBeVisible();
    await fresh.getByRole("button", { name: "모험 이어가기", exact: true }).click();
    await expect(fresh.getByRole("button", { name: "End Turn", exact: true })).toBeEnabled();
    await endTurn(fresh);
    await fresh.getByText("Combat Log", { exact: true }).click();
    await expect(fresh.locator("#combat-log")).toContainText("Aerin ended the turn.");
  } finally { await freshContext.close(); }
});
