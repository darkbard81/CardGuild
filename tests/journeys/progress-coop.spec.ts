import { test, expect, newAdventure, signIn, endTurn } from "../support/journey";
import { register } from "../support/network";
import { nearVictorySave } from "../support/checkpoints";

test("J-PROGRESS victory flows through reward, required growth and preparation into the next encounter", async ({ page, server }) => {
  const account = await register(server.origin, "journey-player");
  nearVictorySave(server.databasePath, account.account.accountId);
  await signIn(page, server.origin);
  await page.getByRole("button", { name: "이어하기", exact: true }).click();
  await page.getByRole("button", { name: "이어하기", exact: true }).click();
  await page.getByRole("button", { name: "모험 이어가기", exact: true }).click();
  await expect(page.getByRole("button", { name: "End Turn", exact: true })).toBeEnabled();
  await page.mouse.click(499, 504);
  await page.getByRole("menu", { name: "길드 연습 상대 · 슬라임", exact: true }).getByRole("menuitem", { name: /^Strike / }).click();
  await expect(page.getByRole("heading", { name: "Choose one reward", exact: true })).toBeVisible();
  await page.getByRole("button", { name: /Brace Behind Cover/ }).click();
  await page.getByRole("button", { name: "이 보상 획득", exact: true }).click();
  await expect(page.getByRole("button", { name: "전투 시작", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Aerin 성장 선택", exact: true }).click();
  await page.getByLabel("Skill Increase").selectOption("athletics");
  await page.getByRole("button", { name: "성장 확정", exact: true }).click();
  await expect(page.getByRole("button", { name: "전투 시작", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "캐릭터 상세", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "캐릭터 상세", exact: true });
  await expect(sheet).toBeVisible();
  await sheet.getByRole("button", { name: "보조손 · Steel Shield", exact: true }).click();
  await sheet.getByRole("button", { name: "장비 해제 비교", exact: true }).click();
  await sheet.getByRole("button", { name: "해제", exact: true }).click();
  await expect(sheet.getByRole("status")).toContainText("저장됨");
  await sheet.getByRole("button", { name: "보조손 · 빈 보조손", exact: true }).click();
  await sheet.getByRole("button", { name: "닫기", exact: true }).click();
  await page.getByRole("button", { name: "전투 시작", exact: true }).click();
  await expect(page.getByRole("region", { name: "Tactical combat", exact: true })).toBeVisible();
  await expect(page.getByRole("list", { name: "Initiative order", exact: true })).toContainText("Spear");
  await page.getByRole("button", { name: "Aerin 상세", exact: true }).click();
  await expect(sheet.getByRole("button", { name: "보조손 · 빈 보조손", exact: true })).toBeVisible();
  await expect(sheet.getByRole("button", { name: "장비 해제 비교", exact: true })).toHaveCount(0);
});

test("J-COOP two browsers join, claim, play and restore guest control after leaving", async ({ page: host, browser, server }) => {
  await newAdventure(host, server.origin, true);
  await host.getByRole("button", { name: "Lyra Co-op 허용", exact: true }).click();
  const invite = await host.getByLabel("초대 코드", { exact: true }).inputValue();
  const guestContext = await browser.newContext({ viewport: { width: 1024, height: 768 } });
  try {
    const guest = await guestContext.newPage();
    await guest.goto(server.origin);
    await guest.getByRole("button", { name: "초대 코드로 참가", exact: true }).click();
    await guest.getByLabel("초대 코드", { exact: true }).fill(invite!);
    await guest.getByLabel("표시 이름 (선택)", { exact: true }).fill("Guest");
    await guest.getByRole("button", { name: "참가하기", exact: true }).click();
    await guest.getByRole("button", { name: "Lyra 선택", exact: true }).click();
    await guest.getByRole("button", { name: "Lyra 선택 확정", exact: true }).click();
    await expect(guest.getByRole("button", { name: "선택 해제", exact: true })).toBeEnabled();
    await host.getByRole("button", { name: "전투 시작", exact: true }).click();
    await expect(guest.getByRole("dialog", { name: "미네르바의 첫 전투 안내", exact: true })).toHaveCount(0);
    await host.getByRole("dialog", { name: "미네르바의 첫 전투 안내", exact: true }).getByRole("button", { name: "건너뛰기", exact: true }).click();
    const guestEnd = guest.getByRole("button", { name: "End Turn", exact: true });
    const hostEnd = host.getByRole("button", { name: "End Turn", exact: true });
    await expect(guest.getByRole("region", { name: "Tactical combat", exact: true })).toBeVisible();
    // Stop at the first guest-controlled turn, never replay a whole encounter.
    await expect.poll(async () => await hostEnd.isEnabled() || await guestEnd.isEnabled()).toBe(true);
    for (let boundary = 0; boundary < 4 && !await guestEnd.isEnabled(); boundary++) {
      const pass = host.getByRole("button", { name: "Pass", exact: true });
      await expect.poll(async () => await guestEnd.isEnabled() || await pass.isVisible() || await hostEnd.isEnabled()).toBe(true);
      if (await guestEnd.isEnabled()) break;
      if (await pass.isVisible()) await pass.click();
      else await endTurn(host);
    }
    await expect(guestEnd).toBeEnabled();
    await guest.goto("about:blank");
    await expect(hostEnd).toBeEnabled();
    await guest.goto(server.origin);
    await expect(guestEnd).toBeEnabled();
    await expect(hostEnd).toBeDisabled();
    // Open both logs while the guest owns the turn. Ending it may immediately open
    // an enemy-triggered Reaction, which must not race a later click on the log.
    await host.getByText("Combat Log", { exact: true }).click();
    await guest.getByText("Combat Log", { exact: true }).click();
    await endTurn(guest);
    await expect(host.locator("#combat-log")).toContainText("Lyra ended the turn.");
    await expect(guest.locator("#combat-log")).toContainText("Lyra ended the turn.");
  } finally { await guestContext.close(); }
});
