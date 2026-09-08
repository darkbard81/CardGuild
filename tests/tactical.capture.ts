import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import sharp from "sharp";
import { expect, test } from "@playwright/test";
import { boardPoint, inspectStrike } from "./tactical-support";
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
    // The ring hub sits on the target, so the board itself is read through the card path:
    // a selected card plus a hovered enemy inspects without anything covering the square.
    await page.keyboard.press("Escape");
    await page.evaluate(() => window.tacticalFixture.addStrikeCard());
    await page.locator('#hand-cards [data-action-id="strike"]').click();
    await page.locator("#pixi-canvas").hover({ position: await boardPoint(page, 2.5, 1.5) });
    await expect(page.locator(".target-ac")).toBeVisible();
    await shot("board-overlay", "링에 가리지 않은 보드: 대상 후방 칸 실선·Rear 표식, 협공 아군 이중 테두리, 대상 Flanking 표식");
    for (let step = 0; step < 4; step++) await page.mouse.wheel(0, -400);
    await page.locator("#pixi-canvas").hover({ position: await boardPoint(page, 2.5, 1.5) });
    await expect(page.locator(".target-ac")).toBeVisible();
    await shot("both-zoomed", "확대 상태의 후방 칸 실선과 협공 아군 이중 테두리");
    await page.keyboard.press("Escape");
    await page.locator("#end-turn").click();
    await page.keyboard.press("ArrowDown");
    await shot("facing-preview", "확정 전 standee·선택 쐐기·후방 칸 표시, authoritative state는 유지");
    await writeFile(path.join(directory, "manifest.json"), JSON.stringify({ viewport: { ...viewport, id, label: "Tactical feedback fixture" }, capturedAt: new Date().toISOString(), shots }, null, 2) + "\n");
  });
}
