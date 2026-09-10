import { expect, test } from "@playwright/test";
import { mountComponent } from "../../support/browser/component-harness";
import type { AdventureState } from "../../../src/adventure";
import type { AdventureUi } from "../../../src/dom/adventure-ui";
import type { LoadoutUi } from "../../../src/dom/loadout-ui";

import type { GrowthSummary } from "../../../src/dom/progression-view";

declare global {
  interface Window {
    progressionFixture: { state: AdventureState; adventureUi: AdventureUi; loadoutUi: LoadoutUi; requests: number };
  }
}

test("renders runtime Level/EXP in both views, including previews and read-only characters", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await mountComponent(page);
  await page.evaluate(async () => {
    const adventurePath = "/src/dom/adventure-ui.ts";
    const loadoutPath = "/src/dom/loadout-ui.ts";
    const runtimePath = "/src/adventure/runtime.ts";
    const contentPath = "/src/content/production-content.ts";
    const catalogPath = "/src/presentation/asset-catalog.ts";
    const { AdventureUi } = await import(adventurePath) as typeof import("../../../src/dom/adventure-ui");
    const { LoadoutUi } = await import(loadoutPath) as typeof import("../../../src/dom/loadout-ui");
    const { createAdventureSession } = await import(runtimePath) as typeof import("../../../src/adventure/runtime");
    const { PRODUCTION_CONTENT: content } = await import(contentPath) as typeof import("../../../src/content/production-content");
    const { createPresentationCatalog } = await import(catalogPath) as typeof import("../../../src/presentation/asset-catalog");
    const pack = content.pack;
    const initial = createAdventureSession({ definition: content.adventure, actorDefinitions: pack.actorDefinitions, combatContent: pack.combatContent }, {
      members: Object.fromEntries(["hero.aerin", "hero.lyra", "hero.brom"].map((id, index) => {
        const memberId = `party.hero-${index + 1}`;
        return [memberId, { id: memberId, seat: (index + 1) as 1 | 2 | 3, actorDefinitionId: id, loadout: pack.actorDefinitions[id]!.starterLoadout }];
      })),
    }, 1);
    const state: AdventureState = { ...initial, party: { members: Object.fromEntries(Object.entries(initial.party.members)
      .map(([id, member], index) => [id, { ...member, progression: { level: index + 2, experience: 375 + index } }])) } };
    const catalog = createPresentationCatalog();
    const app = document.querySelector<HTMLElement>("#app")!;
    const loadoutUi = new LoadoutUi(pack, catalog, {
      onDone: () => { loadoutUi.setVisible(false); app.dataset.screen = "adventure"; },
      onSetLoadout: () => { window.progressionFixture.requests++; return true; },
    });
    const adventureUi = new AdventureUi(content.adventure, pack, {
      onStart: () => undefined, onContinue: () => undefined, onChooseReward: () => undefined, onRetry: () => undefined,
      onOpenLoadout: () => {
        app.dataset.screen = "loadout";
        loadoutUi.render(window.progressionFixture.state, new Set(["party.hero-1"]));
      },
    }, catalog);
    window.progressionFixture = { state, adventureUi, loadoutUi, requests: 0 };
    app.dataset.screen = "adventure";
    adventureUi.render(state);
  });
  await expect(page.locator('#adventure-party [data-member-id="party.hero-1"]')).toContainText("Lv. 2 · EXP 375 / 1000");
  await expect(page.locator('#adventure-party [data-member-id="party.hero-2"]')).toContainText("Lv. 3 · EXP 376 / 1000");
  await page.getByRole("button", { name: "Manage Loadout", exact: true }).click();
  await expect(page.locator("#loadout-screen .character-progression")).toHaveText("Lv. 2 · EXP 375 / 1000");
  await page.locator('.equipment-slot[data-slot="armor"]').hover();
  await expect(page.locator("#loadout-detail")).toContainText("19 → 16");
  await expect(page.locator("#loadout-detail")).toContainText("34 → 34");
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: "덱·능력치", exact: true }).click();
  await expect(page.locator(".deck-panel .loadout-stat").filter({ has: page.getByText("HP", { exact: true }) })).toContainText("34");
  await page.getByRole("tab", { name: "Lyra", exact: true }).click();
  await expect(page.locator("#loadout-screen .character-progression")).toHaveText("Lv. 3 · EXP 376 / 1000");
  await expect(page.locator(".loadout-panel-label")).toContainText("Read-only");
  await expect(page.locator('.equipment-slot[data-slot="weapon"]')).toBeDisabled();
  await page.locator('.equipment-slot[data-slot="weapon"]').hover();
  await expect(page.locator("#loadout-detail")).toContainText("Only this character's owner");
  await page.locator('.equipment-slot[data-slot="weapon"]').dispatchEvent("click");
  expect(await page.evaluate(() => window.progressionFixture.requests)).toBe(0);
  await page.evaluate(() => {
    const fixture = window.progressionFixture;
    const id = "party.hero-2";
    fixture.state = { ...fixture.state, party: { members: { ...fixture.state.party.members,
      [id]: { ...fixture.state.party.members[id]!, progression: { level: 3, experience: 999 } },
    } } };
    fixture.loadoutUi.render(fixture.state, new Set(["party.hero-1"]));
    fixture.adventureUi.render(fixture.state);
  });
  await expect(page.locator("#loadout-screen .character-progression")).toHaveText("Lv. 3 · EXP 999 / 1000");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.locator('#adventure-party [data-member-id="party.hero-2"]')).toContainText("Lv. 3 · EXP 999 / 1000");
  for (const phase of ["between-encounters", "reward", "complete", "failed"] as const) {
    await page.evaluate(phase => {
      const fixture = window.progressionFixture;
      fixture.adventureUi.render({ ...fixture.state, phase });
    }, phase);
    await expect(page.locator("#adventure-party")).toBeVisible();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("#adventure-party li").first()).toContainText("Lv. 2 · EXP 375 / 1000");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("shows the victory growth summary on every screen after the battle and keeps the meters readable", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mountComponent(page);
  await page.evaluate(async () => {
    const adventurePath = "/src/dom/adventure-ui.ts";
    const loadoutPath = "/src/dom/loadout-ui.ts";
    const runtimePath = "/src/adventure/runtime.ts";
    const contentPath = "/src/content/production-content.ts";
    const catalogPath = "/src/presentation/asset-catalog.ts";
    const { AdventureUi } = await import(adventurePath) as typeof import("../../../src/dom/adventure-ui");
    const { LoadoutUi } = await import(loadoutPath) as typeof import("../../../src/dom/loadout-ui");
    const { createAdventureSession } = await import(runtimePath) as typeof import("../../../src/adventure/runtime");
    const { PRODUCTION_CONTENT: content } = await import(contentPath) as typeof import("../../../src/content/production-content");
    const { createPresentationCatalog } = await import(catalogPath) as typeof import("../../../src/presentation/asset-catalog");
    const pack = content.pack;
    const initial = createAdventureSession({ definition: content.adventure, actorDefinitions: pack.actorDefinitions, combatContent: pack.combatContent }, {
      members: Object.fromEntries(["hero.aerin", "hero.lyra", "hero.brom"].map((id, index) => {
        const memberId = `party.hero-${index + 1}`;
        return [memberId, { id: memberId, seat: (index + 1) as 1 | 2 | 3, actorDefinitionId: id, loadout: pack.actorDefinitions[id]!.starterLoadout }];
      })),
    }, 1);
    // The state a fourth victory leaves behind: everyone at Lv.2 with 100 EXP carried.
    const state: AdventureState = {
      ...initial,
      party: { members: Object.fromEntries(Object.entries(initial.party.members)
        .map(([id, member]) => [id, { ...member, progression: { level: 2, experience: 100 } }])) },
    };
    const catalog = createPresentationCatalog();
    const app = document.querySelector<HTMLElement>("#app")!;
    const loadoutUi = new LoadoutUi(pack, catalog, {
      onDone: () => { loadoutUi.setVisible(false); app.dataset.screen = "adventure"; },
      onSetLoadout: () => true,
    });
    const adventureUi = new AdventureUi(content.adventure, pack, {
      onStart: () => undefined, onContinue: () => undefined, onChooseReward: () => undefined, onRetry: () => undefined,
      onOpenLoadout: () => {
        app.dataset.screen = "loadout";
        loadoutUi.render(window.progressionFixture.state, new Set(["party.hero-1"]));
      },
    }, catalog);
    window.progressionFixture = { state, adventureUi, loadoutUi, requests: 0 };
    app.dataset.screen = "adventure";
  });

  const growth: GrowthSummary = {
    encounterId: "encounter.goblin-chief",
    entries: [
      { memberId: "party.hero-1", amount: 400, fromLevel: 1, toLevel: 2, experience: 100 },
      { memberId: "party.hero-2", amount: 400, fromLevel: 1, toLevel: 2, experience: 100 },
      { memberId: "party.hero-3", amount: 400, fromLevel: 1, toLevel: 2, experience: 100 },
    ],
  };
  const render = async (phase: AdventureState["phase"], summary: GrowthSummary | null): Promise<void> => {
    await page.evaluate(([nextPhase, nextGrowth]) => {
      const fixture = window.progressionFixture;
      const reward = fixture.state.adventureId
        ? { rewardId: "reward.goblin-chief", encounterId: "encounter.goblin-chief", choices: [
            { kind: "equipment" as const, definitionId: "greatsword" },
            { kind: "equipment" as const, definitionId: "buckler" },
          ] }
        : null;
      const state = {
        ...fixture.state,
        phase: nextPhase as AdventureState["phase"],
        pendingReward: nextPhase === "reward" ? reward : null,
      };
      fixture.adventureUi.render(state, { isHost: true, growth: nextGrowth as GrowthSummary | null });
    }, [phase, summary] as const);
  };

  // The reward screen is where a victory lands when the encounter grants one.
  await render("reward", growth);
  const panel = page.locator(".growth-summary");
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute("data-encounter-id", "encounter.goblin-chief");
  await expect(panel.locator("li")).toHaveCount(3);
  await expect(panel.locator("li").first()).toContainText("EXP +400");
  await expect(panel.locator("li").first()).toContainText("Lv.1 → Lv.2");
  await expect(panel.locator("li").first()).toContainText("EXP 100 / 1000");
  await expect(page.locator(".reward-choice").first()).toBeInViewport();

  // A battle with no reward goes straight to the next-encounter screen, which must say the
  // same thing rather than swallowing the only notice the player gets.
  await render("between-encounters", growth);
  await expect(page.locator(".growth-summary li")).toHaveCount(3);
  await expect(page.getByRole("button", { name: "Enter Encounter", exact: true })).toBeInViewport();
  await expect(page.getByRole("button", { name: "Manage Loadout", exact: true })).toBeInViewport();

  // The final battle has no next encounter, so the completion screen carries it.
  await render("complete", growth);
  await expect(page.locator(".growth-summary li")).toHaveCount(3);

  // A re-render with no summary shows nothing rather than a stale notice.
  await render("between-encounters", null);
  await expect(page.locator(".growth-summary")).toHaveCount(0);

  // Several levels in one battle read as a single jump.
  await render("between-encounters", {
    encounterId: "encounter.cult-sanctum",
    entries: [{ memberId: "party.hero-1", amount: 2_400, fromLevel: 1, toLevel: 3, experience: 400 }],
  });
  await expect(page.locator(".growth-summary li").first()).toContainText("Lv.1 → Lv.3");
  await expect(page.locator(".growth-summary li").first()).toHaveAttribute("data-levels-gained", "2");

  // The meter is a real progressbar, named and valued, in both views.
  const meter = page.locator('#adventure-party [data-member-id="party.hero-1"] [role="progressbar"]');
  await expect(meter).toHaveAttribute("aria-valuemax", "1000");
  await expect(meter).toHaveAttribute("aria-valuenow", "100");
  await expect(meter).toHaveAttribute("aria-valuetext", /Lv\. 2 · EXP 100 \/ 1000/);

  await page.getByRole("button", { name: "Manage Loadout", exact: true }).click();
  await expect(page.locator('#loadout-screen [role="progressbar"]')).toHaveAttribute("aria-valuenow", "100");
  await expect(page.locator("#loadout-screen .character-progression")).toHaveText("Lv. 2 · EXP 100 / 1000");
  await page.getByRole("button", { name: "Done", exact: true }).click();

  // The plan's accessibility bar for the small viewports: the reward choices and the next
  // battle stay reachable, and nothing scrolls sideways.
  for (const viewport of [{ width: 1024, height: 768 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await render("reward", growth);
    // Reachable, not necessarily all on screen at once: the reward card already scrolls at
    // 1024x768 with four choices, and the notice sits above them.
    await expect(page.locator(".growth-summary")).toBeVisible();
    for (const target of [page.locator(".growth-summary"), page.locator(".reward-choice").first(), page.locator(".reward-choice").last()]) {
      await target.scrollIntoViewIfNeeded();
      await expect(target).toBeInViewport();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    await render("between-encounters", growth);
    await expect(page.locator(".growth-summary")).toBeVisible();
    for (const name of ["Enter Encounter", "Manage Loadout"]) {
      const button = page.getByRole("button", { name, exact: true });
      await button.scrollIntoViewIfNeeded();
      await expect(button).toBeInViewport();
      await expect(button).toBeEnabled();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await render("reward", growth);
  }
});