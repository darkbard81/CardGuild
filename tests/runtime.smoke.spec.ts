import { expect, test } from "@playwright/test";

test("initializes the PixiJS canvas beside the DOM shell", async ({
  page,
}, testInfo) => {
  const runtimeErrors: string[] = [];

  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") {
      runtimeErrors.push(message.text());
    }
  });

  await page.goto("/");

  const pixiRoot = page.locator("#pixi-root");
  const canvas = pixiRoot.locator("canvas#pixi-canvas");

  await expect(pixiRoot).toHaveAttribute("data-ready", "true");
  await expect(canvas).toBeVisible();
  await expect(page.locator("#pixi-status")).toHaveText("Ready");
  await expect(page.locator("#dom-title")).toHaveText("Development shell");

  const canvasSize = await canvas.evaluate((element) => ({
    cssHeight: element.clientHeight,
    cssWidth: element.clientWidth,
    pixelHeight: element.height,
    pixelWidth: element.width,
  }));

  expect(canvasSize.cssWidth).toBeGreaterThan(300);
  expect(canvasSize.cssHeight).toBeGreaterThan(300);
  expect(canvasSize.pixelWidth).toBeGreaterThanOrEqual(canvasSize.cssWidth);
  expect(canvasSize.pixelHeight).toBeGreaterThanOrEqual(canvasSize.cssHeight);
  expect(runtimeErrors).toEqual([]);

  await page.screenshot({
    path: testInfo.outputPath("cardguild-runtime.png"),
    fullPage: true,
  });
});
