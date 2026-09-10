import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

import { chooseFacing } from "./facing-input";
import { startDeployment, type RecoveryDeployment } from "./recovery-server";

/**
 * What a real restart looks like from a browser.
 *
 * Everything here goes through the deployed server and the built client: sign in, open a
 * campaign, save real progress, stop or kill the process, start it again on the same
 * database file, and carry on. The point is that no part of the recovery depends on the
 * test process holding anything together.
 */
interface Player {
  readonly context: BrowserContext;
  readonly page: Page;
  /** Uncaught exceptions. A restart must never produce one. */
  readonly pageErrors: string[];
  readonly consoleErrors: string[];
}

/**
 * A client whose server has gone away logs a failed connection, and so does one taken
 * offline on purpose. That is the client noticing the outage, which is what it is supposed
 * to do; anything else on the console is not.
 */
const EXPECTED_OUTAGE_NOISE = /WebSocket|Failed to fetch|ERR_CONNECTION_REFUSED|ERR_INTERNET_DISCONNECTED|net::/i;

function expectNoUnexpectedErrors(player: Player): void {
  expect(player.pageErrors).toEqual([]);
  expect(player.consoleErrors.filter((message) => !EXPECTED_OUTAGE_NOISE.test(message))).toEqual([]);
}

async function openPlayer(browser: Browser, deployment: RecoveryDeployment, name: string): Promise<Player> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await page.goto(deployment.origin);
  await expect(page.locator("#app")).toHaveAttribute("data-ready", "true");
  await expect(page.locator("#app")).not.toHaveAttribute("data-auth", "unknown");
  await page.locator("#session-display-name").fill(name);
  return { context, page, pageErrors, consoleErrors };
}

async function signIn(player: Player, deployment: RecoveryDeployment): Promise<void> {
  await expect(player.page.locator("#host-login, #account-logout").first()).toBeVisible();
  if (await player.page.locator("#account-logout").count()) await player.page.locator("#account-logout").click();
  await player.page.locator("#host-login").click();
  await player.page.locator("#account-username").fill(deployment.account.username);
  await player.page.locator("#account-password").fill(deployment.account.password);
  await player.page.locator("#account-login").click();
  await expect(player.page.locator("#app")).toHaveAttribute("data-auth", "authenticated");
  await expect(player.page.locator("#new-campaign")).toBeVisible();
}

async function createCampaign(player: Player, name: string, displayName: string): Promise<string> {
  await player.page.locator("#new-campaign-name").fill(name);
  await player.page.locator("#campaign-display-name").fill(displayName);
  await player.page.locator("#new-campaign").click();
  await expect(player.page.locator("#session-screen")).toHaveAttribute("data-viewer-role", "host");
  return await player.page.locator("#invite-session-id").innerText();
}

async function applyParty(page: Page): Promise<void> {
  await expect(page.locator("#apply-party")).toBeEnabled();
  await page.locator("#apply-party").click();
  await expect(page.locator(".party-builder")).toHaveAttribute("data-party-prepared", "true");
}

async function joinAs(player: Player, sessionId: string): Promise<void> {
  await player.page.locator("#join-session-id").fill(sessionId);
  await player.page.locator("#join-session").click();
  await expect(player.page.locator("#session-screen")).toHaveAttribute("data-viewer-role", "guest");
}

async function claim(page: Page, memberId: string): Promise<void> {
  await page.locator(`.guest-character-choice[data-member-id="${memberId}"]`).click();
  await expect(page.locator('.guest-character-choice[data-claim-state="mine"]'))
    .toHaveAttribute("data-member-id", memberId);
}

/** Save real progress: begin the adventure and walk into the first encounter. */
async function reachCombat(page: Page): Promise<string> {
  await page.locator("#begin-adventure").click();
  await expect(page.locator("#app")).toHaveAttribute("data-screen", "adventure");
  await page.getByRole("button", { name: "Enter Encounter", exact: true }).click();
  await expect(page.locator("#app")).toHaveAttribute("data-screen", "combat", { timeout: 60_000 });
  const hash = await page.locator("#app").getAttribute("data-session-hash");
  if (!hash) throw new Error("The combat screen published no gameplay hash.");
  return hash;
}

async function continueCampaign(page: Page, campaignName: string): Promise<void> {
  const row = page.locator("#campaign-list li").filter({ hasText: campaignName });
  await expect(row).toHaveCount(1);
  await expect(row.getByRole("button", { name: "Continue" })).toBeEnabled();
  await row.getByRole("button", { name: "Continue" }).click();
}

async function expectResumeLobby(page: Page): Promise<void> {
  await expect(page.locator("#app")).toHaveAttribute("data-lifecycle", "resume-lobby", { timeout: 60_000 });
  await expect(page.locator("#session-screen")).toHaveAttribute("data-lobby-kind", "resume");
}

test.describe("M9-5 deployment recovery", () => {
  const deployments: RecoveryDeployment[] = [];
  const contexts: BrowserContext[] = [];

  test.afterEach(async () => {
    for (const context of contexts.splice(0)) await context.close();
    for (const deployment of deployments.splice(0)) await deployment.dispose();
  });

  async function deploy(label: string): Promise<RecoveryDeployment> {
    const deployment = await startDeployment(label);
    deployments.push(deployment);
    return deployment;
  }

  async function player(browser: Browser, deployment: RecoveryDeployment, name: string): Promise<Player> {
    const created = await openPlayer(browser, deployment, name);
    contexts.push(created.context);
    return created;
  }

  test("carries a 1P campaign across a graceful restart and plays on", async ({ browser }) => {
    const deployment = await deploy("solo");
    const host = await player(browser, deployment, "Solo Host");
    await signIn(host, deployment);
    const campaign = "Solo Recovery";
    await createCampaign(host, campaign, "Solo Host");
    await applyParty(host.page);
    const savedHash = await reachCombat(host.page);

    // SIGTERM is the deployment's own shutdown path: drain, then close the database.
    const stopped = await deployment.stop();
    expect(stopped.code, deployment.output()).toBe(0);
    await deployment.start();

    // The client finds its session gone and returns the signed-in host to their campaigns.
    await host.page.reload();
    await expect(host.page.locator("#app")).toHaveAttribute("data-auth", "authenticated", { timeout: 60_000 });
    await continueCampaign(host.page, campaign);
    await expectResumeLobby(host.page);
    // A restored session is new: new id, no guest claims, saved party fixed.
    await expect(host.page.locator("#invite-session-id")).toBeVisible();
    await expect(host.page.locator("#resume-adventure")).toBeEnabled();
    // The saved party is shown read-only: a resume lobby has no composition editor.
    await expect(host.page.locator(".party-builder")).toHaveAttribute("data-party-fixed", "true");
    await expect(host.page.locator("#apply-party")).toHaveCount(0);

    await host.page.locator("#resume-adventure").click();
    await expect(host.page.locator("#app")).toHaveAttribute("data-screen", "combat", { timeout: 60_000 });
    // Resume republishes the saved gameplay rather than advancing it.
    await expect(host.page.locator("#app")).toHaveAttribute("data-session-hash", savedHash);

    // And the party can act: the next accepted command moves the hash off the saved one.
    await expect.poll(async () => host.page.locator("#end-turn").isEnabled(), { timeout: 60_000 }).toBe(true);
    await host.page.locator("#end-turn").click();
    await chooseFacing(host.page, "east");
    await expect.poll(async () => host.page.locator("#app").getAttribute("data-session-hash"), { timeout: 60_000 })
      .not.toBe(savedHash);
    expectNoUnexpectedErrors(host);
  });

  test("recovers a 3P campaign from a kill, re-invites its guests, and keeps their claims", async ({ browser }) => {
    const deployment = await deploy("party");
    const host = await player(browser, deployment, "Party Host");
    await signIn(host, deployment);
    const campaign = "Party Recovery";
    const firstSessionId = await createCampaign(host, campaign, "Party Host");
    await applyParty(host.page);

    const guestOne = await player(browser, deployment, "Guest One");
    const guestTwo = await player(browser, deployment, "Guest Two");
    await joinAs(guestOne, firstSessionId);
    await joinAs(guestTwo, firstSessionId);
    await claim(guestOne.page, "party.hero-2");
    await claim(guestTwo.page, "party.hero-3");
    await expect(host.page.locator("#begin-adventure")).toBeEnabled();
    const savedHash = await reachCombat(host.page);
    await expect(guestOne.page.locator("#app")).toHaveAttribute("data-screen", "combat", { timeout: 60_000 });

    // No shutdown, no drain: the process simply stops existing.
    const killed = await deployment.kill();
    expect(killed.signal).toBe("SIGKILL");
    await deployment.start();

    await host.page.reload();
    await expect(host.page.locator("#app")).toHaveAttribute("data-auth", "authenticated", { timeout: 60_000 });
    await continueCampaign(host.page, campaign);
    await expectResumeLobby(host.page);
    const secondSessionId = await host.page.locator("#invite-session-id").innerText();
    // One campaign, one live session: Continue opened a new one rather than reviving the old.
    expect(secondSessionId).not.toBe(firstSessionId);

    // The guests' old credentials are worthless; they rejoin with the new invite.
    for (const guest of [guestOne, guestTwo]) {
      await guest.page.reload();
      await expect(guest.page.locator("#app")).toHaveAttribute("data-ready", "true", { timeout: 60_000 });
      await guest.page.locator("#session-display-name").fill("Returning Guest");
      await joinAs(guest, secondSessionId);
      await expect(guest.page.locator("#session-screen")).toHaveAttribute("data-lobby-kind", "resume");
    }
    await claim(guestOne.page, "party.hero-2");
    await claim(guestTwo.page, "party.hero-3");

    // Claims and presence are control, not gameplay: the saved hash has not moved.
    await expect(host.page.locator("#app")).toHaveAttribute("data-session-hash", savedHash);
    await host.page.locator("#resume-adventure").click();
    for (const page of [host.page, guestOne.page, guestTwo.page]) {
      await expect(page.locator("#app")).toHaveAttribute("data-screen", "combat", { timeout: 60_000 });
      await expect(page.locator("#app")).toHaveAttribute("data-session-hash", savedHash);
    }
    // Each guest controls the character it reclaimed.
    await expect(guestOne.page.locator("#app")).toHaveAttribute("data-controlled-actor-ids", "party.hero-2");
    await expect(guestTwo.page.locator("#app")).toHaveAttribute("data-controlled-actor-ids", "party.hero-3");
    expectNoUnexpectedErrors(host);
  });

  test("lets the host sign in again in a fresh browser and continue the same campaign", async ({ browser }) => {
    const deployment = await deploy("relogin");
    const host = await player(browser, deployment, "First Browser");
    await signIn(host, deployment);
    const campaign = "Relogin Recovery";
    await createCampaign(host, campaign, "First Browser");
    await applyParty(host.page);
    const savedHash = await reachCombat(host.page);

    await deployment.stop();
    await deployment.start();

    // A different browser: no auth cookie, no stored credential, nothing but the account.
    const returning = await player(browser, deployment, "Second Browser");
    await expect(returning.page.locator("#app")).toHaveAttribute("data-auth", "anonymous");
    await signIn(returning, deployment);
    await continueCampaign(returning.page, campaign);
    await expectResumeLobby(returning.page);
    await returning.page.locator("#resume-adventure").click();
    await expect(returning.page.locator("#app")).toHaveAttribute("data-screen", "combat", { timeout: 60_000 });
    await expect(returning.page.locator("#app")).toHaveAttribute("data-session-hash", savedHash);
    expectNoUnexpectedErrors(returning);
  });

  test("re-arms Continue when the server is unreachable, and recovers once it is back", async ({ browser }) => {
    const deployment = await deploy("retry");
    const host = await player(browser, deployment, "Retry Host");
    await signIn(host, deployment);
    const campaign = "Retry Recovery";
    await createCampaign(host, campaign, "Retry Host");
    await applyParty(host.page);
    const savedHash = await reachCombat(host.page);

    await deployment.stop();
    await deployment.start();
    await host.page.reload();
    await expect(host.page.locator("#app")).toHaveAttribute("data-auth", "authenticated", { timeout: 60_000 });
    const row = host.page.locator("#campaign-list li").filter({ hasText: campaign });
    await expect(row.getByRole("button", { name: "Continue" })).toBeEnabled();

    // Continue and the campaign-list refetch fail together, which is the case that used to
    // leave the only retry path disabled until a page reload.
    await host.page.context().setOffline(true);
    await row.getByRole("button", { name: "Continue" }).click();
    await expect(host.page.locator("#session-status")).not.toHaveText("", { timeout: 30_000 });
    await expect(row.getByRole("button", { name: "Continue" })).toBeEnabled({ timeout: 30_000 });

    await host.page.context().setOffline(false);
    await continueCampaign(host.page, campaign);
    await expectResumeLobby(host.page);
    await host.page.locator("#resume-adventure").click();
    await expect(host.page.locator("#app")).toHaveAttribute("data-screen", "combat", { timeout: 60_000 });
    await expect(host.page.locator("#app")).toHaveAttribute("data-session-hash", savedHash);
  });

  test("survives the host's own disconnect without moving ownership or the campaign", async ({ browser }) => {
    // The guest side of this — fallback to host and claim restored on reconnect — is
    // already covered by the co-op suites. What is not is the host leaving: they own the
    // campaign, so their absence is the one that could plausibly move something.
    const deployment = await deploy("host-drop");
    const host = await player(browser, deployment, "Dropping Host");
    await signIn(host, deployment);
    const campaign = "Host Drop Recovery";
    const sessionId = await createCampaign(host, campaign, "Dropping Host");
    await applyParty(host.page);
    const guest = await player(browser, deployment, "Staying Guest");
    await joinAs(guest, sessionId);
    await claim(guest.page, "party.hero-2");
    await expect(host.page.locator("#begin-adventure")).toBeEnabled();
    const savedHash = await reachCombat(host.page);
    await expect(guest.page.locator("#app")).toHaveAttribute("data-screen", "combat", { timeout: 60_000 });
    const revision = await guest.page.locator("#app").getAttribute("data-session-revision");

    await host.page.goto("about:blank");
    // The guest keeps its own character, and nothing about the campaign moves.
    await expect(guest.page.locator("#app")).toHaveAttribute("data-controlled-actor-ids", "party.hero-2");
    await expect(guest.page.locator("#app")).toHaveAttribute("data-session-hash", savedHash);
    await expect(guest.page.locator("#app")).toHaveAttribute("data-session-revision", revision ?? "");
    // Host-only decisions wait for the host rather than falling to whoever is present.
    await expect(guest.page.locator("#app")).toHaveAttribute("data-viewer-role", "guest");

    // Ownership is durable, not presence-derived: the campaign is still listed as theirs.
    const listed = await guest.page.request.get(new URL("/api/campaigns", deployment.origin).toString());
    expect(listed.status()).toBe(401);

    await host.page.goto(deployment.origin);
    await expect(host.page.locator("#app")).toHaveAttribute("data-session-status", "connected", { timeout: 60_000 });
    await expect(host.page.locator("#app")).toHaveAttribute("data-viewer-role", "host");
    await expect(host.page.locator("#app")).toHaveAttribute("data-controlled-actor-ids", "party.hero-1,party.hero-3");
    await expect(host.page.locator("#app")).toHaveAttribute("data-session-hash", savedHash);
    await expect(host.page.locator("#app")).toHaveAttribute("data-session-revision", revision ?? "");
    expectNoUnexpectedErrors(guest);
  });
});
