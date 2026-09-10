import { expect, test } from "@playwright/test";
import { createCampaignAsHost } from "../support/browser/host-login";

test("shows authoritative starting progression through the real Host flow", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await createCampaignAsHost(page, "Progression Host");
  await page.locator("#apply-party").click();
  await page.locator("#begin-adventure").click();
  await expect(page.locator("#app")).toHaveAttribute("data-screen", "adventure");
  await expect(page.locator("#adventure-party li")).toHaveCount(3);
  for (const row of await page.locator("#adventure-party li").all()) {
    await expect(row).toContainText("Lv. 1 · EXP 0 / 1000");
    await expect(row).toBeInViewport();
  }
  await expect(page.getByRole("button", { name: "Enter Encounter", exact: true })).toBeInViewport();
  await expect(page.locator("#adventure-collection")).toBeInViewport();
  await expect(page.locator("#adventure-progress li").last()).toBeInViewport();
  const mapBounds = await page.locator(".adventure-map-card").boundingBox();
  expect(mapBounds!.y).toBeGreaterThanOrEqual(0);
  expect(mapBounds!.y + mapBounds!.height).toBeLessThanOrEqual(768);
  await page.getByRole("button", { name: "Manage Loadout", exact: true }).click();
  await expect(page.locator("#loadout-screen .character-progression")).toHaveText("Lv. 1 · EXP 0 / 1000");
  await expect(page.locator(".loadout-pagination")).toBeInViewport();
  await expect(page.getByRole("button", { name: "Done", exact: true })).toBeInViewport();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.reload();
  await expect(page.locator("#adventure-party li")).toHaveCount(3);
  await expect(page.locator("#adventure-party li").first()).toContainText("Lv. 1 · EXP 0 / 1000");
});
