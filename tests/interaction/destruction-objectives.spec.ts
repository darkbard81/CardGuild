import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";
import { BoardProjection } from "../../src/pixi/battle/BoardProjection";
import { BattleCamera } from "../../src/pixi/battle/BattleCamera";
import { controlledSession } from "../support/browser-backend";
import { gateObjectiveCheckpoint } from "../support/chapter-one";
import { tutorialAct as act, tutorialContext as context } from "../support/tutorial";
import { saveRecord } from "../support/session";
import { restoreCampaignSave } from "../../src/server/campaign-save";
import { createResumedSessionCoreState } from "../../src/session";

/** Locate a grid target using the laid-out HUD. Expected picked IDs below are independent. */
async function targetPoint(page: Page, x: number, y: number) {
  const frame = await page.locator(".combat-stage").evaluate(stage => {
    const b = stage.getBoundingClientRect();
    const insets = {left:0,right:0,top:0,bottom:0};
    for (const el of stage.querySelectorAll<HTMLElement>("[data-hud-gutter]")) {
      const r=el.getBoundingClientRect(); if (!r.width || !r.height) continue;
      const edge=el.dataset.hudGutter as keyof typeof insets;
      const value=edge==="left"?r.right-b.left:edge==="right"?b.right-r.left:edge==="top"?r.bottom-b.top:b.bottom-r.top;
      insets[edge]=Math.max(insets[edge],value+8);
    }
    const h=Math.min(1,b.width*0.5/Math.max(1,insets.left+insets.right));
    const v=Math.min(1,b.height*0.5/Math.max(1,insets.top+insets.bottom));
    return {viewportWidth:b.width,viewportHeight:b.height,columns:20,rows:20,
      safeArea:{left:insets.left*h,right:insets.right*h,top:insets.top*v+Math.min(144,b.height*0.18),bottom:insets.bottom*v},left:b.left,top:b.top};
  });
  const projection=new BoardProjection(); projection.update(20,20,new BattleCamera().placement(frame));
  const p=projection.surfaceToScreen(x+0.5,y+0.5);return {x:p.x+frame.left,y:p.y+frame.top};
}

// Solid dark badge pixels distinguish the annotation from the unchanged tree/rock artwork.
async function badgePixels(page:Page,p:{x:number;y:number}) {
  const {data,info}=await sharp(await page.screenshot()).extract({left:Math.round(p.x-33),top:Math.round(p.y-40),width:66,height:20}).raw().toBuffer({resolveWithObject:true});
  let count=0;for(let i=0;i<data.length;i+=info.channels) if(Math.abs(data[i]!-21)<=2&&Math.abs(data[i+1]!-27)<=2&&Math.abs(data[i+2]!-34)<=2) count++;
  return count;
}

test("U-DESTRUCTION-UI marked targets, hover names and committed progress survive Resume", async ({page},info)=>{
  const initial=gateObjectiveCheckpoint();
  const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
  const backend=await controlledSession(page,initial,"resume","host","skip",context);
  await expect(page.getByRole("button",{name:"End Turn",exact:true})).toBeEnabled();
  const progress=page.locator("#objective-progress");
  await expect(progress).toHaveText("파괴 목표 0/2 완료 · 남은 2");
  const first=await targetPoint(page,8,8), second=await targetPoint(page,11,8), ordinary=await targetPoint(page,7,8);
  await expect.poll(()=>badgePixels(page,first)).toBeGreaterThan(500);
  expect(await badgePixels(page,second)).toBeGreaterThan(500);
  await page.screenshot({path:info.outputPath("gate-targets-before.png")});
  await page.mouse.move(ordinary.x,ordinary.y);
  await expect(page.locator("#action-preview-summary")).toHaveText("나무");
  await page.mouse.move(first.x,first.y);
  await expect(page.locator("#action-preview-summary")).toHaveText("파괴 목표 1 · 서쪽 피난문 나무");
  expect(backend.requests).toHaveLength(0);
  await page.mouse.click(first.x,first.y);
  await expect(page.getByRole("menu",{name:"파괴 목표 1 · 서쪽 피난문 나무",exact:true}).getByRole("menuitem",{name:/장애물 파괴/})).toBeEnabled();
  await page.getByRole("menuitem",{name:/장애물 파괴/}).click();
  await expect.poll(()=>backend.requests.length).toBe(1);
  expect(backend.requests[0]!.intent).toMatchObject({type:"use-action",target:{kind:"object",objectId:"willow-gate-tree-8-8"}});
  const destroyed=backend.candidate();backend.ack(true,destroyed.revision);
  await expect(progress).toHaveText("파괴 목표 0/2 완료 · 남은 2");
  backend.publish(destroyed);await page.mouse.move(30,740);
  await expect(progress).toHaveText("파괴 목표 1/2 완료 · 남은 1");
  await expect.poll(()=>badgePixels(page,first)).toBeLessThan(100);
  expect(await badgePixels(page,second)).toBeGreaterThan(500);
  await page.screenshot({path:info.outputPath("gate-targets-after.png")});
  const restored=restoreCampaignSave(saveRecord(destroyed),context).projection;
  backend.publish(act(createResumedSessionCoreState({sessionId:initial.sessionId,playerId:"host",displayName:"Host"},restored,context),{type:"resume-adventure"}));
  await page.reload({waitUntil:"domcontentloaded"});
  await expect(progress).toHaveText("파괴 목표 1/2 완료 · 남은 1");
  await expect.poll(()=>badgePixels(page,second)).toBeGreaterThan(500);
  expect(await badgePixels(page,first)).toBeLessThan(100);
  await page.mouse.move(second.x,second.y);
  await expect(page.locator("#action-preview-summary")).toHaveText("파괴 목표 2 · 동쪽 피난문 바위");
  await page.screenshot({path:info.outputPath("gate-targets-resumed.png")});
  expect(errors).toEqual([]);
});
