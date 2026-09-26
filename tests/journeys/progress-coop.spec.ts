import { test, expect, signIn, endTurn } from "../support/journey";
import { register } from "../support/network";
import { nearVictorySave, recruitedSave } from "../support/checkpoints";

test("J-PROGRESS first victory, growth, forced Prone, Ring Stand and second victory recruit Aerin", async ({ page, server }) => {
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
  await page.getByRole("button", { name: "Arlen 성장 선택", exact: true }).click();
  await page.getByLabel("Skill Increase").selectOption("athletics");
  await page.getByRole("button", { name: "성장 확정", exact: true }).click();
  await expect(page.getByRole("button", { name: "전투 시작", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "전투 시작", exact: true }).click();
  await expect(page.getByRole("region", { name: "Tactical combat", exact: true })).toBeVisible();
  const scene = page.getByRole("dialog", { name: "미네르바의 상태 회복 안내", exact: true });
  await expect(scene).toContainText("AC가 2");
  await scene.getByRole("button", { name: "건너뛰기", exact: true }).click();
  await expect(scene).toHaveCount(0);
  await page.mouse.click(259, 386);
  await page.getByRole("menuitem", { name: /^Stand / }).click();
  await expect(page.getByRole("button", { name: "End Turn", exact: true })).toBeEnabled();
  const recruit = page.getByRole("button", { name: "Aerin 선택", exact: true });
  for (let action = 0; action < 15 && !await recruit.isVisible(); action++) {
    const end = page.getByRole("button", { name: "End Turn", exact: true });
    await expect.poll(async () => await recruit.isVisible() || await end.isEnabled()).toBe(true);
    if (await recruit.isVisible()) break;
    if (await page.getByLabel("Action available", { exact: true }).count() === 0) {
      // The existing zero-action flow already requests a facing, so this click ends the turn.
      await page.mouse.click(499, 504);
      await expect.poll(async () => await recruit.isVisible() || await page.getByLabel("Action available", { exact: true }).count() > 0).toBe(true);
      continue;
    }
    await page.mouse.click(379, 446);
    const strike = page.getByRole("menuitem", { name: /^Strike / });
    if (await strike.isEnabled()) await strike.click();
    else { await page.keyboard.press("Escape"); await endTurn(page); }
    // Await the action's committed presentation, not a fixed delay or a whole extra turn.
    await expect.poll(async () => await recruit.isVisible() || await end.isEnabled()).toBe(true);
  }
  await expect(recruit).toBeVisible();
  await recruit.click();
  await page.getByRole("button", { name: "동료 합류", exact: true }).click();
  await expect(page.getByRole("button", { name: "Aerin Co-op 허용", exact: true })).toBeVisible();

});

test("J-COOP two browsers join, claim, play and restore guest control after leaving", async ({ page: host, browser, server }) => {
  const account = await register(server.origin, "journey-player");
  recruitedSave(server.databasePath, account.account.accountId);
  await signIn(host, server.origin);
  await host.getByRole("button", { name: "이어하기", exact: true }).click();
  await host.getByRole("button", { name: "이어하기", exact: true }).click();
  await host.getByRole("button", { name: "모험 이어가기", exact: true }).click();
  await host.getByRole("button", { name: "Aerin Co-op 허용", exact: true }).click();
  const invite = await host.getByLabel("초대 코드", { exact: true }).inputValue();
  const guestContext = await browser.newContext({ viewport: { width: 1024, height: 768 } });
  try {
    const guest = await guestContext.newPage();
    await guest.goto(server.origin);
    await guest.getByRole("button", { name: "초대 코드로 참가", exact: true }).click();
    await guest.getByLabel("초대 코드", { exact: true }).fill(invite!);
    await guest.getByLabel("표시 이름 (선택)", { exact: true }).fill("Guest");
    await guest.getByRole("button", { name: "참가하기", exact: true }).click();
    await guest.getByRole("button", { name: "Aerin 선택", exact: true }).click();
    await guest.getByRole("button", { name: "Aerin 선택 확정", exact: true }).click();
    await expect(guest.getByRole("button", { name: "선택 해제", exact: true })).toBeEnabled();
    await host.getByRole("button", { name: "전투 시작", exact: true }).click();
    await expect(guest.getByRole("dialog", { name: "미네르바의 첫 전투 안내", exact: true })).toHaveCount(0);
    await expect(host.getByRole("dialog", { name: "미네르바의 첫 전투 안내", exact: true })).toHaveCount(0);
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
    await expect(host.locator("#combat-log")).toContainText("Aerin ended the turn.");
    await expect(guest.locator("#combat-log")).toContainText("Aerin ended the turn.");
  } finally { await guestContext.close(); }
});
