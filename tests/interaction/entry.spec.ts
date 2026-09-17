import { expect, test } from "@playwright/test";

test("U-ENTRY a late account response preserves the join destination, draft and focus", async ({ page }) => {
  let reply!: () => Promise<void>;
  await page.route("**/api/auth/me", route => { reply = () => route.fulfill({ json: { account: { accountId: "account", username: "Returning" } } }); });
  await page.goto("/");
  await page.getByRole("button", { name: "초대 코드로 참가", exact: true }).click();
  const code = page.getByLabel("초대 코드", { exact: true });
  await code.fill("friend-invite");
  const response = page.waitForResponse("**/api/auth/me");
  await reply();
  await (await response).finished();
  await expect(page.getByRole("heading", { name: "초대 코드로 참가", exact: true })).toBeVisible();
  await expect(code).toHaveValue("friend-invite");
  await expect(code).toBeFocused();
  await page.getByRole("button", { name: "시작 화면으로", exact: true }).click();
  await expect(page.getByRole("button", { name: "로그아웃", exact: true })).toBeVisible();
});

test("U-ENTRY failed login can be corrected and retried; pending submission is unique and returns to intended new adventure", async ({ page }) => {
  await page.route("**/api/auth/me", route => route.fulfill({ json: { account: null } }));
  let attempts = 0; let finish!: () => Promise<void>;
  await page.route("**/api/auth/login", route => {
    attempts++;
    finish = () => route.fulfill(attempts === 1
      ? { status: 401, json: { code: "UNAUTHENTICATED", message: "Incorrect password" } }
      : { json: { account: { accountId: "account", username: "Player" } } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "새 모험 시작", exact: true }).click();
  await page.getByLabel("계정 이름", { exact: true }).fill("Player");
  await page.getByLabel("비밀번호", { exact: true }).fill("wrong-password");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect.poll(() => attempts).toBe(1);
  await expect(page.getByRole("button", { name: "로그인", exact: true })).toBeDisabled();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status").filter({ hasText: "로그인" })).toBeVisible();
  expect(attempts).toBe(1);
  await finish();
  await expect(page.getByRole("status").filter({ hasText: "계정 이름 또는 비밀번호" })).toContainText("계정 이름 또는 비밀번호");
  await page.getByLabel("비밀번호", { exact: true }).fill("correct-password");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect.poll(() => attempts).toBe(2);
  await finish();
  await expect(page.getByLabel("모험 이름", { exact: true })).toBeVisible();
});

test("U-ENTRY expired campaign access returns to login and preserves the Continue destination", async ({ page }) => {
  const account = { accountId: "account", username: "Player" };
  await page.route("**/api/auth/me", route => route.fulfill({ json: { account } }));
  let authorized = false;
  await page.route("**/api/campaigns", route => route.fulfill(authorized
    ? { json: { campaigns: [] } } : { status: 401, json: { code: "UNAUTHENTICATED", message: "Session expired" } }));
  await page.route("**/api/auth/login", route => { authorized = true; return route.fulfill({ json: { account } }); });
  await page.goto("/");
  await page.getByRole("button", { name: "이어하기", exact: true }).click();
  await expect(page.getByRole("heading", { name: "로그인", exact: true })).toBeVisible();
  await page.getByLabel("계정 이름", { exact: true }).fill("Player");
  await page.getByLabel("비밀번호", { exact: true }).fill("correct-password");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page.getByRole("heading", { name: "이어하기", exact: true })).toBeVisible();
});
