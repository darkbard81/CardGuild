import { expect, test } from "@playwright/test";
import { createCampaignProject } from "../../src/authoring/default-project";
import { duplicateCampaignEncounter } from "../../src/authoring/duplicate";
import { placeCampaignObject } from "../../src/authoring/edit-map";
import type { CampaignProject } from "../../src/authoring/types";
import type { ServerSnapshot } from "../../src/protocol";
import { authoredBuild } from "../support/authored-build";
import { productProcess } from "../support/process";
import { newAdventure } from "../support/journey";

function authoredProject(): CampaignProject {
  const original = createCampaignProject();
  const id = "encounter.authored-delivery";
  let project = duplicateCampaignEncounter(original, "encounter.guild-practice", id, "보급품 회수");
  project = { ...project, content: { ...project.content, traits: [...project.content.traits, {
    id: "authored-crate", name: "보급 상자", source: "cardguild", category: "terrain", description: "작성한 회수 목표", cardGrants: [], actionGrants: [],
  }] }, presentation: { ...project.presentation, objects: [...project.presentation.objects, {
    id: "authored-crate", name: "보급 상자", visual: "object.chest", interaction: "destroy-obstacle",
  }] } };
  project = placeCampaignObject(project, id, "authored-crate", { x: 1, y: 1 });
  const source = project.content.scenarios.find(s => s.id === id)!;
  const adventureId = "adventure.authored-delivery";
  const sceneId = `${id}.briefing`;
  const reward = original.content.adventures.find(a => a.id === original.activeAdventureId)!.rewards[0]!;
  return { ...project, activeAdventureId: adventureId, authoredAdventureIds: [adventureId], content: { ...project.content,
    scenarios: project.content.scenarios.map(s => s.id !== id ? s : { ...s,
      objective: { kind: "resolve-objectives", description: "보급 상자를 회수하세요." },
      rules: { ...s.rules, victory: { enemyIds: [], objectIds: [source.map.objects[0]!.id] } },
    }), adventures: [...project.content.adventures, { id: adventureId, name: "직접 만든 배송 모험", description: "도구에서 제작한 한 전장 캠페인", partySize: { min: 1, max: 1 },
      encounterIds: [id], experienceAwards: [{ afterEncounterId: id, amount: 35 }],
      rewards: [{ ...reward, id: "reward.authored-delivery", afterEncounterId: id }],
      ending: { title: "보급품 배달 완료", description: "새 캠페인의 대사, 오브젝트, 보상이 연결되었습니다." },
    }],
  }, dialogue: { scenes: { ...project.dialogue.scenes, [sceneId]: { id: sceneId, lines: [{ text: "새로 배치한 보급 상자를 회수하면 길드가 보상합니다." }] } },
    bindings: { ...project.dialogue.bindings, encounters: { ...project.dialogue.bindings.encounters,
      [id]: { sceneId, title: "작성한 출발 대사", finishLabel: "상자 회수 시작" },
    } },
  } };
}

test("J-AUTHOR seed=60 edited project applies to an isolated build: authored dialogue, custom object victory, XP, reward and ending", async ({ page }, info) => {
  const project = authoredProject();
  const build = await authoredBuild(project);
  let server: Awaited<ReturnType<typeof productProcess>> | undefined;
  const snapshots: ServerSnapshot[] = [];
  page.on("websocket", socket => socket.on("framereceived", frame => {
    const message = JSON.parse(String(frame.payload));
    if (message.type === "snapshot") snapshots.push(message);
  }));
  try {
    server = await productProcess(build.root);
    await server.start();
    await newAdventure(page, server.origin);
    await page.getByRole("button", { name: "전투 시작", exact: true }).click();
    const dialogue = page.getByRole("dialog", { name: "작성한 출발 대사", exact: true });
    await expect(dialogue).toContainText("새로 배치한 보급 상자");
    await expect(dialogue).toContainText("상자 회수 시작");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "End Turn", exact: true })).toBeEnabled();
    await page.screenshot({ path: info.outputPath("authored-combat.png") });
    // Center of the authored crate on the fitted 3x3 board at 1024x768.
    await page.mouse.click(379, 444);
    await page.getByRole("menuitem", { name: /장애물 파괴/ }).click();
    await expect(page.getByRole("heading", { name: "Choose one reward", exact: true })).toBeVisible();
    const rewardState = snapshots.at(-1)!.state.adventure!;
    expect(rewardState.adventureId).toBe(project.activeAdventureId);
    expect(rewardState.completedEncounterIds).toEqual(["encounter.authored-delivery"]);
    expect(Object.values(rewardState.party.members)[0]!.progression.experience).toBe(35);
    await page.locator(".reward-choice").first().click();
    await page.getByRole("button", { name: "이 보상 획득", exact: true }).click();
    await expect(page.getByRole("heading", { name: "보급품 배달 완료", exact: true })).toBeVisible();
    const complete = snapshots.at(-1)!.state.adventure!;
    const grant = project.content.adventures.at(-1)!.rewards[0]!.choices[0]!;
    if (grant.kind !== "card") throw new Error("Authored journey expects a card reward");
    expect(complete.collection.cards[grant.definitionId]).toBe((rewardState.collection.cards[grant.definitionId] ?? 0) + 1);
    expect(complete.phase).toBe("complete");
    await page.screenshot({ path: info.outputPath("authored-ending.png") });
  } catch (error) {
    await info.attach("authored-server-seed-60", { body: server?.log ?? "Server was not started", contentType: "text/plain" });
    await info.attach("authored-progress", { body: JSON.stringify({ seed: 60, adventureId: project.activeAdventureId,
      revision: snapshots.at(-1)?.revision, phase: snapshots.at(-1)?.state.adventure?.phase }), contentType: "application/json" });
    throw error;
  } finally {
    try { await server?.dispose(); } finally { await build.dispose(); }
  }
});
