import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import sharp from "sharp";
import { expect, test } from "@playwright/test";
import { boardPoint, inspectStrike } from "./support/browser/tactical-support";
import type { TacticalCase } from "./fixtures/tactical";

for (const viewport of [{ width: 1024, height: 768 }, { width: 1440, height: 900 }]) {
  test(`tactical feedback album ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.route(/\/src\/main\.ts(\?|$)/, (route) => route.fulfill({ contentType: "application/javascript", body: 'import "/tests/fixtures/tactical.ts";' }));
    await page.goto("/");
    await expect(page.locator("#app")).toHaveAttribute("data-ready", "true");
    const id = `${viewport.width}x${viewport.height}-tactical`;
    const directory = path.join(process.env.CARDGUILD_UI_SHOT_DIR ?? "docs/ui-review/current", id);
    await mkdir(directory, { recursive: true });
    const shots: { id: string; title: string; note: string; file: string }[] = [];
    const shot = async (name: string, note: string) => {
      const file = `${name}.png`;
      await writeFile(path.join(directory, file), await sharp(await page.screenshot()).png({ compressionLevel: 9 }).toBuffer());
      shots.push({ id: name, title: name, note, file });
    };
    for (const mode of ["front", "rear", "flanking", "both"] as TacticalCase[]) {
      await page.evaluate((value) => window.tacticalFixture.reset(value), mode);
      await inspectStrike(page);
      await shot(mode, "같은 Strike plan에서 받은 AC·원인·협공 아군 표시");
    }
    // The same relationship close up: the board stays terrain and standees, and the whole
    // explanation is still the inspector's.
    await page.keyboard.press("Escape");
    await page.locator("#pixi-canvas").hover({ position: await boardPoint(page, 2.5, 1.5) });
    for (let step = 0; step < 4; step++) await page.mouse.wheel(0, -400);
    await inspectStrike(page);
    await shot("both-zoomed", "확대해도 보드에는 규칙 설명 overlay가 없고 HUD만 설명한다");
    await page.keyboard.press("Escape");
    await page.locator("#end-turn").click();
    await expect(page.locator("#pixi-canvas")).toHaveAttribute("data-facing-position", /^\d+,\d+$/);
    await shot("facing-select", "방향 선택 모드: 바라볼 보드 위치를 한 번 고르면 Facing이 정해지고 전송된다");
    await writeFile(path.join(directory, "manifest.json"), JSON.stringify({ viewport: { ...viewport, id, label: "Tactical feedback fixture" }, capturedAt: new Date().toISOString(), shots }, null, 2) + "\n");
  });
}
