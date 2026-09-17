import { expect, test } from "@playwright/test";
import { DEV_HOST_A, openApp, createCampaignAsHost } from "../support/browser/host-login";

const account = DEV_HOST_A;

test("new adventure keeps its purpose through login and submits each form with Enter", async ({ page }) => {
  await openApp(page);
  await page.getByRole("button", { name: "새 모험 시작", exact: true }).click();
  await page.getByLabel("계정 이름", { exact: true }).fill(account.username);
  await page.getByLabel("비밀번호", { exact: true }).fill(account.password);
  await page.getByLabel("비밀번호", { exact: true }).press("Enter");
  await expect(page.getByRole("heading", { name: "새 모험 시작" })).toBeVisible();
  await page.getByLabel("모험 이름", { exact: true }).fill(`Entry ${Date.now()}`);
  await page.getByLabel("모험 이름", { exact: true }).press("Enter");
  await expect(page.locator("#session-screen")).toHaveAttribute("data-viewer-role", "host");
});

test("restored account offers all three purposes and failed logout remains signed in", async ({ page }) => {
  await page.request.post("/api/auth/login", { data: account });
  await openApp(page);
  for (const name of ["새 모험 시작", "초대 코드로 참가", "이어하기"]) {
    await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
  }
  await page.getByRole("button", { name: "초대 코드로 참가", exact: true }).click();
  await expect(page.getByLabel("초대 코드", { exact: true })).toBeVisible();
  await page.locator("#join-back").click();
  await page.route("**/api/auth/logout", route => route.abort());
  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  await expect(page.locator("#session-status")).toContainText("로그아웃하지 못했습니다");
  await expect(page.locator("#app")).toHaveAttribute("data-auth", "authenticated");
  await page.unroute("**/api/auth/logout");
  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  await expect(page.locator("#app")).toHaveAttribute("data-auth", "anonymous");
});

test("late account restoration never replaces an open join form", async ({ page }) => {
  await page.request.post("/api/auth/login", { data: account });
  let release = () => undefined as void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/auth/me", async route => { await held; await route.continue(); });
  await page.goto("/");
  await page.getByRole("button", { name: "초대 코드로 참가", exact: true }).click();
  await page.getByLabel("초대 코드", { exact: true }).fill("session_draft");
  release();
  await expect(page.locator("#app")).toHaveAttribute("data-auth", "authenticated");
  await expect(page.getByLabel("초대 코드", { exact: true })).toHaveValue("session_draft");
  await page.locator("#join-back").click();
  await expect(page.locator("#entry-continue")).toBeVisible();
});

test("failed auth restoration offers retry and keeps anonymous joining reachable", async ({ page }) => {
  await page.route("**/api/auth/me", route => route.abort());
  await openApp(page);
  await expect(page.locator("#app")).toHaveAttribute("data-auth", "error");
  await expect(page.locator("#entry-new-adventure")).toBeDisabled();
  await page.locator("#entry-join").click();
  await expect(page.locator("#join-session-id")).toBeVisible();
  await page.locator("#join-back").click();
  await page.unroute("**/api/auth/me");
  await page.locator("#entry-retry-auth").click();
  await expect(page.locator("#app")).toHaveAttribute("data-auth", "anonymous");
  await expect(page.locator("#entry-new-adventure")).toBeEnabled();
});

test("campaign loading retries and expired creation returns to the draft after login", async ({ page }) => {
  await page.request.post("/api/auth/login", { data: account });
  await openApp(page);
  await page.route("**/api/campaigns", route => route.abort());
  await page.locator("#entry-continue").click();
  await expect(page.locator("#session-status")).toContainText("모험을 불러오지 못했습니다");
  await page.unroute("**/api/campaigns");
  await page.locator("#campaigns-retry").click();
  await expect(page.locator("#campaign-list")).toBeVisible();
  await page.locator("#entry-new-adventure").click();
  await page.getByLabel("모험 이름", { exact: true }).fill("Preserved draft");
  await page.request.post("/api/auth/logout");
  await page.locator("#new-campaign").click();
  await expect(page.locator("#session-status")).toContainText("로그인이 만료");
  await page.getByLabel("계정 이름", { exact: true }).fill(account.username);
  await page.getByLabel("비밀번호", { exact: true }).fill(account.password);
  await page.locator("#account-login").click();
  await expect(page.getByLabel("모험 이름", { exact: true })).toHaveValue("Preserved draft");
});

test("guest corrects an invalid invite and Enter joins once while the request is pending", async ({ browser }) => {
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  try {
    const host = await hostContext.newPage();
    await createCampaignAsHost(host, "Entry Host");
    await host.locator("#apply-party").click();
    await expect(host.locator("#apply-party")).toBeDisabled();
    const code = await host.locator("#invite-session-id").innerText();
    const guest = await guestContext.newPage();
    await openApp(guest);
    await guest.locator("#entry-join").click();
    await guest.getByLabel("초대 코드", { exact: true }).fill("session_missing_entry");
    await guest.getByLabel("초대 코드", { exact: true }).press("Enter");
    await expect(guest.locator("#session-status")).toContainText("초대 코드를 찾을 수 없습니다");
    await expect(guest.getByLabel("초대 코드", { exact: true })).toHaveValue("session_missing_entry");
    let requests = 0;
    let release = () => undefined as void;
    const held = new Promise<void>(resolve => { release = resolve; });
    await guest.route("**/api/sessions/*/join", async route => { requests++; await held; await route.continue(); });
    await guest.getByLabel("초대 코드", { exact: true }).fill(`  ${code}  `);
    await guest.getByLabel("초대 코드", { exact: true }).press("Enter");
    await expect(guest.locator("#join-session")).toBeDisabled();
    await guest.locator("form").dispatchEvent("submit");
    expect(requests).toBe(1);
    release();
    await expect(guest.locator("#session-screen")).toHaveAttribute("data-viewer-role", "guest");
    const second = await guestContext.newPage();
    await openApp(second);
    await second.locator("#entry-join").click();
    await second.getByLabel("초대 코드", { exact: true }).fill(code);
    await second.getByLabel("초대 코드", { exact: true }).press("Enter");
    await expect(second.locator("#session-screen")).toHaveAttribute("data-viewer-role", "guest");
    const overflow = await guestContext.newPage();
    await openApp(overflow);
    await overflow.locator("#entry-join").click();
    await overflow.getByLabel("초대 코드", { exact: true }).fill(code);
    await overflow.getByLabel("초대 코드", { exact: true }).press("Enter");
    await expect(overflow.locator("#session-status")).toContainText("참가 인원이 가득 찼습니다");
    await expect(overflow.locator("#join-session")).toBeEnabled();
    await expect(overflow.getByLabel("초대 코드", { exact: true })).toHaveValue(code);
  } finally {
    await hostContext.close();
    await guestContext.close();
  }
});

test("expired Continue login returns to the campaign list", async ({ page }) => {
  await page.request.post("/api/auth/login", { data: account });
  await openApp(page);
  await page.request.post("/api/auth/logout");
  await page.locator("#entry-continue").click();
  await expect(page.locator("#session-status")).toContainText("로그인이 만료");
  await page.getByLabel("계정 이름", { exact: true }).fill(account.username);
  await page.getByLabel("비밀번호", { exact: true }).fill(account.password);
  await page.getByLabel("비밀번호", { exact: true }).press("Enter");
  await expect(page.locator("#campaign-list")).toBeVisible();
});


test("returning to entry while auth is pending settles into usable choices", async ({ page }) => {
  let release = () => undefined as void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/auth/me", async route => { await held; await route.continue(); });
  await page.goto("/");
  await page.locator("#entry-join").click();
  await page.locator("#join-back").click();
  await expect(page.locator("#entry-new-adventure")).toBeDisabled();
  release();
  await expect(page.locator("#entry-new-adventure")).toBeEnabled();
  await expect(page.locator("#host-login")).toBeVisible();
});
