import { expect, test } from "@playwright/test";

test("U-ELEVATION actual raised board picks/hover, edits heights and restores JSON without touching saves", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/terrain-preview.html");
  const status = page.locator("#status");
  await expect(status).toHaveAttribute("data-revision", "1");
  await page.screenshot({ path: info.outputPath("terrain-flat.png") });
  await page.getByRole("button", { name: "높이 0·1·2·4 예제" }).click();
  await expect(status).toHaveAttribute("data-revision", "2");
  // 1024×768, real 3×3 board. A clear point on the near raised tile's existing top art.
  await page.mouse.move(255, 428);
  await expect(status).toContainText("호버 1,2");
  await page.mouse.click(255, 428);
  await expect(status).toContainText("선택 1,2 · 높이 4");
  await page.screenshot({ path: info.outputPath("terrain-raised.png") });
  const height = page.getByRole("spinbutton", { name: "선택 타일 높이" });
  await height.fill("2"); await height.press("Tab");
  await expect(status).toContainText("선택 1,2 · 높이 2");
  await page.screenshot({ path: info.outputPath("terrain-lowered.png") });
  await page.mouse.move(215, 612);
  await expect(status).toContainText("호버 없음"); // Exposed side blocks the surface behind it.
  await page.getByRole("button", { name: "높이 JSON 내보내기" }).click();
  const json = page.getByRole("textbox", { name: "높이 파일" });
  const saved = await json.inputValue();
  expect(JSON.parse(saved).maps["encounter.guild-practice"]).toEqual([0, 1, 2, 4, 0, 1, 2, 2, 0]);
  await page.getByRole("button", { name: "모두 높이 0" }).click();
  await expect(status).toContainText("높이 0");
  await json.fill(saved);
  await page.getByRole("button", { name: "높이 JSON 불러오기" }).click();
  await expect(page.getByRole("alert")).toHaveText("높이를 복원했습니다.");
  await page.mouse.click(255, 512);
  await expect(status).toContainText("선택 1,2 · 높이 2");
  // Camera gestures still invert before raised-surface picking.
  await page.mouse.move(255, 512); await page.mouse.wheel(0, -300);
  await page.mouse.click(255, 512);
  await expect(status).toContainText("선택 1,2 · 높이 2");
  await page.keyboard.down("Alt"); await page.mouse.move(400, 500);
  await page.mouse.down(); await page.mouse.move(430, 520); await page.mouse.up(); await page.keyboard.up("Alt");
  await page.mouse.click(285, 532);
  await expect(status).toContainText("선택 1,2 · 높이 2");
  await json.fill('{"version":1,"maps":{"encounter.guild-practice":[9]}}');
  await page.getByRole("button", { name: "높이 JSON 불러오기" }).click();
  await expect(page.getByRole("alert")).toContainText("0~8 정수 배열");
  await expect(status).toContainText("높이 2");
  await json.fill('{"version":1,"maps":{}}');
  await page.getByRole("button", { name: "높이 JSON 불러오기" }).click();
  await page.getByRole("button", { name: "높이 JSON 내보내기" }).click();
  expect(JSON.parse(await json.inputValue())).toEqual({ version: 1, maps: {} });
  expect(errors).toEqual([]);
});
