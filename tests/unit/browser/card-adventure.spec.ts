import { expect, test } from "@playwright/test";
import { mountComponent } from "../../support/browser/component-harness";

for (const viewport of [{ width: 1024, height: 768 }, { width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`shows whole cards in collection and rewards at ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await mountComponent(page);
    await page.evaluate(async () => {
      const uiPath = "/src/dom/adventure-ui.ts";
      const contentPath = "/src/content/production-content.ts";
      const runtimePath = "/src/adventure/runtime.ts";
      const assetPath = "/src/presentation/asset-catalog.ts";
      const { AdventureUi } = await import(uiPath) as typeof import("../../../src/dom/adventure-ui");
      const { PRODUCTION_CONTENT: content } = await import(contentPath) as typeof import("../../../src/content/production-content");
      const { createAdventureSession } = await import(runtimePath) as typeof import("../../../src/adventure/runtime");
      const { createPresentationCatalog } = await import(assetPath) as typeof import("../../../src/presentation/asset-catalog");
      const actor = content.pack.actorDefinitions["hero.aerin"]!;
      const initial = createAdventureSession({ definition: content.adventure, actorDefinitions: content.pack.actorDefinitions,
        characterRules: content.pack.characterRules, combatContent: content.pack.combatContent }, {
        members: { hero: { id: "hero", seat: 1, actorDefinitionId: actor.id, loadout: actor.starterLoadout } },
      }, 1);
      const ids = ["card.telekinetic-projectile", "card.brace-behind-cover", "card.heal"];
      const ui = new AdventureUi(content.adventure, content.pack, {
        onAdvanceCharacter: () => false, onStart: () => undefined, onContinue: () => undefined,
        onChooseReward: (_reward, index) => { document.body.dataset.chosenReward = String(index); },
        onOpenLoadout: () => undefined, onRetry: () => undefined,
      }, createPresentationCatalog());
      document.querySelector<HTMLElement>("#app")!.dataset.screen = "adventure";
      ui.render({ ...initial, phase: "reward", collection: { ...initial.collection, cards: Object.fromEntries(ids.map((id) => [id, 2])) },
        pendingReward: { rewardId: "card-art-reward", encounterId: content.adventure.encounterIds[0]!,
          choices: ids.map((definitionId) => ({ kind: "card" as const, definitionId })),
        },
      });
    });
    await page.getByText("보유 보상·Collection", { exact: true }).click();
    await expect(page.locator(".collection-card")).toHaveCount(3);
    await expect(page.locator(".reward-card-choice .card-face")).toHaveCount(3);
    for (const card of await page.locator(".collection-card, .reward-card-choice .card-face").all()) {
      await expect(card).toHaveAttribute("data-image-state", "ready");
      const size = await card.boundingBox();
      expect(size!.width / size!.height).toBeCloseTo(2 / 3, 2);
      await expect(card.locator(".card-face-art")).toHaveCSS("background-size", "contain");
    }
    await page.locator(".collection-card").last().scrollIntoViewIfNeeded();
    const collection = (await page.locator(".collection-chips").boundingBox())!;
    const lastCard = (await page.locator(".collection-card").last().boundingBox())!;
    expect(lastCard.y).toBeGreaterThanOrEqual(collection.y);
    expect(lastCard.y + lastCard.height).toBeLessThanOrEqual(collection.y + collection.height + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
    await expect(page.locator(".reward-card-choice button")).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("adventure-card-art.png"), fullPage: true });
    await page.locator(".reward-card-choice").filter({ hasText: "Heal" }).click();
    await expect(page.locator("body")).toHaveAttribute("data-chosen-reward", "2");
  });
}
