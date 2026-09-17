import { expect, test, type Page } from "@playwright/test";
import { mountComponent } from "../../support/browser/component-harness";

async function mountCards(page: Page): Promise<number> {
  await mountComponent(page);
  return page.evaluate(async () => {
    const facePath = "/src/dom/card-face.ts";
    const assetPath = "/src/presentation/asset-catalog.ts";
    const contentPath = "/src/content/production-content.ts";
    const { createCardFace } = await import(facePath) as typeof import("../../../src/dom/card-face");
    const { createPresentationCatalog } = await import(assetPath) as typeof import("../../../src/presentation/asset-catalog");
    const { PRODUCTION_CONTENT } = await import(contentPath) as typeof import("../../../src/content/production-content");
    const catalog = createPresentationCatalog();
    const content = PRODUCTION_CONTENT.pack.combatContent;
    const gallery = document.createElement("section");
    gallery.id = "card-gallery";
    Object.assign(gallery.style, { position: "fixed", inset: "16px", display: "flex", flexWrap: "wrap", alignContent: "start", gap: "16px", zIndex: "1000", background: "#18221d", padding: "16px", overflowY: "auto" });
    for (const id of Object.keys(content.cards)) {
      const card = content.cards[id]!;
      const button = document.createElement("button");
      button.className = "tactical-card";
      button.dataset.cardId = id;
      button.append(createCardFace({ catalog, cardId: id, name: card.name, timing: content.actions[card.actionId]!.timing }));
      button.onclick = () => { button.dataset.clicked = "true"; };
      gallery.append(button);
    }
    document.body.append(gallery);
    return Object.keys(content.cards).length;
  });
}

for (const viewport of [{ width: 1024, height: 768 }, { width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`displays every production card as a full portrait at ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    const cardCount = await mountCards(page);
    const images = page.locator('#card-gallery .card-face[data-art-storage="image"]');
    await expect(images).toHaveCount(cardCount);
    for (const face of await images.all()) {
      await expect(face).toHaveAttribute("data-image-state", "ready");
      const size = await face.boundingBox();
      expect(size!.width / size!.height).toBeCloseTo(2 / 3, 2);
      expect(size!.width).toBeLessThan(512);
      const art = face.locator(".card-face-art");
      await expect(art).toHaveCSS("background-size", "contain");
      expect(await art.boundingBox()).toEqual(size);
    }
    await expect(page.locator('[data-card-id="card.vicious-swing"] .card-face-cost')).toHaveText("●●");
    await expect(page.locator('[data-card-id="card.force-barrage"] .card-face-cost')).toHaveText("●");
    await expect(page.locator('[data-card-id="card.heal"] .card-face-cost')).toHaveText("●");
    await expect(page.locator('[data-card-id="card.reactive-strike"] .card-face-cost')).toHaveText("↻");
    await expect(page.locator('#card-gallery .card-face[data-art-storage="atlas"]')).toHaveCount(0);
    const gallery = page.locator("#card-gallery");
    expect(await gallery.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("all-cards.png") });
  });
}

test("keeps the card label, cost and input when its image fails", async ({ page }) => {
  await page.route("**/assets/cards/heal.webp", (route) => route.abort());
  await mountCards(page);
  const card = page.locator('[data-card-id="card.heal"]');
  await expect(card.locator(".card-face")).toHaveAttribute("data-image-state", "error");
  await expect(card.locator(".card-face-name")).toHaveText("Heal");
  await expect(card.locator(".card-face-cost")).toHaveText("●");
  await card.click();
  await expect(card).toHaveAttribute("data-clicked", "true");
});

test.describe("high density display", () => {
  test.use({ deviceScaleFactor: 2, viewport: { width: 1024, height: 768 } });
  test("keeps CSS card sizes separate from delivery resolution", async ({ page }, testInfo) => {
    await mountCards(page);
    await expect(page.locator('[data-card-id="card.heal"] .card-face')).toHaveAttribute("data-image-state", "ready");
    const size = await page.locator('[data-card-id="card.heal"]').boundingBox();
    expect(size!.width).toBe(104);
    expect(size!.height).toBe(156);
    await page.screenshot({ path: testInfo.outputPath("all-cards-dpr2.png") });
  });
});
