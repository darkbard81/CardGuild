import { expect, test, type Page } from "@playwright/test";
import { listLegalActions, listLegalTargets } from "../../src/game/queries";
import type { CombatCommand, CombatState } from "../../src/game";
import type { ServerMessage, ServerSnapshot } from "../../src/protocol";
import { chooseHeroCommand } from "../../tools/playtest/hero-policy";
import { createCampaignAsHost } from "../support/browser/host-login";
import { boardPoint } from "../support/browser/tactical-support";
import { settledBoard } from "../support/browser/board-camera";
import { chooseFacing } from "../support/browser/facing-input";

function awaitingPlayer(snapshot: ServerSnapshot): boolean {
  const { adventure, combat } = snapshot.state;
  if (adventure?.phase !== "combat" || !combat) return true;
  const actorId = combat.pendingReaction?.candidates[0]?.actorId ?? combat.turn.activeActorId;
  return combat.actors[actorId]?.team === "heroes";
}

/** Read published state to choose input; every mutation below is an actual UI gesture. */
async function play(page: Page, combat: CombatState, command: CombatCommand): Promise<void> {
  if (command.type === "end-turn") {
    await page.locator("#end-turn").click();
    await chooseFacing(page, command.facing);
    return;
  }
  if (command.type !== "use-action") throw new Error(`Unexpected command ${command.type}`);
  await expect(page.locator("#pixi-canvas")).toHaveAttribute("data-board-corners", /^\[\{/);
  await settledBoard(page);
  const target = command.target;
  const position = target.kind === "tile" ? target.position : target.kind === "actor"
    ? combat.actors[target.actorId]!.position : target.kind === "object"
      ? combat.map.objects[target.objectId]!.position : combat.actors[command.actorId]!.position;
  const clickTarget = async (): Promise<void> => {
    await page.locator("#pixi-canvas").click({ position: await boardPoint(page, position.x + 0.5, position.y + 0.5) });
  };
  if (command.action.kind === "card") {
    await page.locator(`#hand-cards [data-source-id="${command.action.id}"]`).click();
    if (target.kind === "actor" || target.kind === "tile" || target.kind === "object") await clickTarget();
  } else {
    await clickTarget();
    await page.locator(`#ring-root [data-action-id="${command.action.id}"]`).click();
  }
  if (target.kind === "tile" && target.facing) await chooseFacing(page, target.facing);
}

test("Spear Line reward stays locked until level 2, then prepares and executes in the next encounter", async ({ page }) => {
  // Five encounters use real animations and AI turns, including on shared CI workers.
  test.setTimeout(600_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  let latest: ServerSnapshot | undefined;
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("websocket", socket => socket.on("framereceived", frame => {
    const message = JSON.parse(String(frame.payload)) as ServerMessage;
    if (message.type === "snapshot") latest = message;
  }));
  await createCampaignAsHost(page, "Card Level Campaign");
  const pack = await page.evaluate(async () => {
    const path = "/src/content/production-content.ts";
    const module = await import(path) as typeof import("../../src/content/production-content");
    return module.PRODUCTION_CONTENT.pack;
  });
  const content = pack.combatContent;
  await page.locator("#party-slot-2").selectOption("hero.brom");
  await page.locator("#party-slot-3").selectOption("hero.nera");
  await page.locator("#apply-party").click();
  await page.locator("#begin-adventure").click();
  await expect.poll(() => latest?.state.adventure?.adventureSeed).toBe(1);
  let checkedLocked = false;
  let prepared = false;
  let used = false;
  for (let step = 0; step < 1200 && !used; step++) {
    if (await page.locator("#restart-battle").isVisible()) await page.locator("#restart-battle").click();
    await expect.poll(() => latest && awaitingPlayer(latest), { timeout: 20_000 }).toBe(true);
    const snapshot = latest!;
    const adventure = snapshot.state.adventure!;
    expect(adventure.phase, `campaign failed at ${adventure.currentEncounterId}`).not.toBe("failed");
    await expect(page.locator("#app")).toHaveAttribute("data-session-revision", String(snapshot.revision));
    const member = adventure.party.members["party.hero-1"]!;
    let attemptedAction: string = adventure.phase;
    if (adventure.phase === "reward") {
      const offer = adventure.pendingReward!;
      const index = offer.rewardId === "reward.spear-line"
        ? offer.choices.findIndex(choice => choice.definitionId === "card.combat-grab") : await page.evaluate(async adventure => {
          const path = "/tests/support/campaign/adventure-driver.ts";
          const driver = await import(path) as typeof import("../support/campaign/adventure-driver");
          return driver.rewardChoiceIndex(adventure);
        }, adventure);
      const button = page.locator(".reward-choice").nth(index);
      if (offer.rewardId === "reward.spear-line") {
        await expect(button).toContainText("요구 레벨 2");
        await expect(button).toBeEnabled();
      }
      await button.click();
    } else if (adventure.phase === "ready" || adventure.phase === "between-encounters") {
      if (adventure.collection.cards["card.combat-grab"] && (!checkedLocked || (!prepared && member.progression.level >= 2))) {
        await page.getByRole("button", { name: "Manage Loadout", exact: true }).click();
        await page.getByRole("tab", { name: "Aerin", exact: true }).click();
        await page.getByRole("tab", { name: "준비 카드", exact: true }).click();
        const card = page.locator('[data-option-id="card.combat-grab"]');
        if (member.progression.level === 1) {
          await expect(card).toHaveAttribute("aria-disabled", "true");
          await card.hover();
          await expect(page.locator("#loadout-detail")).toContainText("요구 레벨 2 · 현재 레벨 1");
          checkedLocked = true;
        } else {
          await expect(card).toHaveAttribute("aria-disabled", "false");
          await card.click();
          await expect.poll(() => latest?.state.adventure?.party.members[member.id]?.loadout.preparedCards.includes("card.combat-grab")).toBe(true);
          prepared = true;
        }
        await page.getByRole("button", { name: "Done", exact: true }).click();
        if (!prepared) await page.getByRole("button", { name: "Enter Encounter", exact: true }).click();
        else continue;
      } else {
        const heal = await page.evaluate(async adventure => {
          const path = "/tests/support/campaign/adventure-driver.ts";
          const driver = await import(path) as typeof import("../support/campaign/adventure-driver");
          return driver.prepareHealingIntent(adventure);
        }, adventure);
        if (heal?.type === "set-loadout") {
          const owner = adventure.party.members[heal.memberId]!;
          const cardId = heal.loadout.preparedCards.find(id => !owner.loadout.preparedCards.includes(id))!;
          await page.getByRole("button", { name: "Manage Loadout", exact: true }).click();
          await page.getByRole("tab", { name: pack.actorDefinitions[owner.actorDefinitionId]!.name, exact: true }).click();
          await page.getByRole("tab", { name: "준비 카드", exact: true }).click();
          await page.locator(`[data-option-id="${cardId}"]`).click();
          await expect.poll(() => latest?.revision).toBeGreaterThan(snapshot.revision);
          await page.getByRole("button", { name: "Done", exact: true }).click();
          continue;
        }
        await page.getByRole("button", { name: "Enter Encounter", exact: true }).click();
      }
    } else if (adventure.phase === "combat") {
      const combat = snapshot.state.combat!;
      if (combat.pendingReaction) await page.locator("#reaction-use").click();
      else {
        const grab = prepared && combat.turn.activeActorId === member.id && listLegalActions(combat, member.id, content)
          .find(action => action.actionId === "combat-grab" && action.enabled);
        const target = grab ? listLegalTargets(combat, member.id, grab.source, content).find(target => target.kind === "actor") : undefined;
        let command: CombatCommand | null = grab && target?.kind === "actor"
          ? { type: "use-action", id: "ui-grab", sequence: combat.sequence + 1, actorId: member.id, action: grab.source, target: { kind: "actor", actorId: target.actorId } }
          : chooseHeroCommand(combat, content);
        if (!command) throw new Error("The UI driver found no legal command.");
        // Clicking an object opens its interaction menu. Walk beside it, as a player
        // would, instead of asking the tile-only policy to walk onto its square.
        if (command.type === "use-action" && command.target.kind === "tile") {
          const requested = command.target.position;
          const objects = Object.values(combat.map.objects).filter(object => !object.used);
          if (objects.some(object => object.position.x === requested.x && object.position.y === requested.y)) {
            const destination = listLegalTargets(combat, command.actorId, command.action, content)
              .filter(target => target.kind === "tile" && !objects.some(object => object.position.x === target.position.x && object.position.y === target.position.y))
              .sort((a, b) => a.kind === "tile" && b.kind === "tile"
                ? Math.abs(a.position.x - requested.x) + Math.abs(a.position.y - requested.y)
                  - Math.abs(b.position.x - requested.x) - Math.abs(b.position.y - requested.y) : 0)[0];
            if (destination?.kind !== "tile") throw new Error("No accessible square beside the object.");
            command = { ...command, target: { ...command.target, position: destination.position } };
          }
        }
        attemptedAction = `${combat.scenarioId}/${JSON.stringify(command)}`;
        await test.step(`${combat.scenarioId}/${combat.round}/${command.actorId}/${JSON.stringify(command)}`, () => play(page, combat, command));
        if (grab && target) {
          await expect.poll(() => latest?.revision).toBeGreaterThan(snapshot.revision);
          expect(latest?.state.adventure?.currentEncounterId).toBe("encounter.bone-cellar");
          expect(latest?.state.combat?.commandLog.some(command => command.type === "use-action" && command.action.id === grab.source.id)).toBe(true);
          used = true;
        }
      }
    } else throw new Error(`Unexpected campaign phase ${adventure.phase}`);
    if (!used) await expect.poll(() => latest?.revision, { message: `No committed change after ${attemptedAction}` }).toBeGreaterThan(snapshot.revision);
  }
  expect({ checkedLocked, prepared, used }).toEqual({ checkedLocked: true, prepared: true, used: true });
  expect(errors).toEqual([]);
});
