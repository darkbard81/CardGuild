import { expect, test } from "@playwright/test";
import { controlledSession } from "../support/browser-backend";
import { chapterAt, chapterReward } from "../support/chapter-one";
import { tutorialContext as context } from "../support/tutorial";

for (const index of [1, 2, 3]) test(`U-CHAPTER briefing ${index + 1} opens the authored objective map`, async ({ page }, info) => {
  const backend = await controlledSession(page, chapterAt(index), "join", "host", "skip", context);
  await page.getByRole("button", { name: "전투 시작", exact: true }).click();
  const scene = page.getByRole("dialog", { name: "챕터 1 · Aerin의 고향", exact: true });
  await expect(scene).toContainText(index === 1 ? "두 궁수" : index === 2 ? "피난문" : "광장");
  await scene.getByRole("button", { name: "건너뛰기", exact: true }).click();
  await expect.poll(() => backend.requests.length).toBe(1);
  const started = backend.candidate(); backend.ack(true,started.revision); backend.publish(started);
  await expect(page.getByRole("region",{name:"Tactical combat",exact:true})).toBeVisible();
  await expect(page.locator("canvas")).toBeVisible();
  await page.screenshot({path:info.outputPath(`chapter-${index+1}.png`)});
});

test("U-CHAPTER final reward commits ending and Shield remains preparable after completion", async ({ page }, info) => {
  const backend = await controlledSession(page,chapterReward(chapterAt(3)),"join","host","skip",context);
  await page.getByRole("button",{name:/Shield/}).filter({hasText:"Shield"}).first().click();
  await page.getByRole("button",{name:"이 보상 획득",exact:true}).click();
  await expect.poll(()=>backend.requests.length).toBe(1);
  const complete = backend.candidate(); backend.ack(true,complete.revision); backend.publish(complete);
  await expect(page.getByRole("heading",{name:"챕터 1 완료 · 윌로우브룩에 돌아온 불빛",exact:true})).toBeVisible();
  await expect(page.getByRole("button",{name:"전투 시작",exact:true})).toHaveCount(0);
  await page.screenshot({path:info.outputPath("chapter-ending.png")});
  await page.getByRole("button",{name:"보상·장비 정리",exact:true}).click();
  const sheet=page.getByRole("dialog",{name:"캐릭터 상세",exact:true});
  await sheet.getByRole("tab",{name:"카드",exact:true}).click();
  await sheet.getByRole("button",{name:/^Shield · 보유/}).click();
  await expect(sheet).toContainText("Shield Block");
  await sheet.getByRole("button",{name:"준비 추가",exact:true}).click();
  await expect.poll(()=>backend.requests.length).toBe(2);
  const equipped=backend.candidate();backend.ack(true,equipped.revision);backend.publish(equipped);
  await expect(sheet.getByRole("button",{name:"Shield · 준비됨",exact:true})).toBeVisible();
  await expect(sheet.getByRole("status").filter({hasText:"저장됨"})).toBeVisible();
  await page.screenshot({path:info.outputPath("chapter-shield-prepared.png")});
});
