import { expect, it } from "vitest";
import { destructionObjectives, destructionObjectiveLabel } from "../../src/presentation/destruction-objectives";
import { gateObjectiveCheckpoint } from "../support/chapter-one";
import { tutorialAct as act, tutorialContext as context } from "../support/tutorial";
import { restoreCampaignSave } from "../../src/server/campaign-save";
import { createResumedSessionCoreState } from "../../src/session";
import { saveRecord } from "../support/session";

it("G-DESTRUCTION-UI only authored targets count, numbering survives ordinary destruction and save/Resume", () => {
  let session = gateObjectiveCheckpoint();
  const summary = () => destructionObjectives(session.combat!).map(t => ({ id: t.object.id, number: t.number, complete: t.complete }));
  expect(summary()).toEqual([
    { id:"willow-gate-tree-8-8",number:1,complete:false },{ id:"willow-gate-rock-11-8",number:2,complete:false },
  ]);
  expect(destructionObjectiveLabel(session.combat!,"willow-gate-tree-7-8")).toBeUndefined();
  const destroy = (id:string) => { session = act(session,{type:"use-action",action:{kind:"context",id:"destroy-obstacle"},target:{kind:"object",objectId:id}}); };
  const initial = session;
  session = act(session,{type:"use-action",action:{kind:"basic",id:"step"},target:{kind:"tile",position:{x:7,y:9}}});
  destroy("willow-gate-tree-7-8");
  expect(summary().filter(t=>!t.complete)).toHaveLength(2);
  session = initial;
  destroy("willow-gate-tree-8-8");
  expect(summary()).toEqual([
    { id:"willow-gate-tree-8-8",number:1,complete:true },{ id:"willow-gate-rock-11-8",number:2,complete:false },
  ]);
  expect(destructionObjectiveLabel(session.combat!,"willow-gate-tree-8-8")).toBeUndefined();
  expect(destructionObjectiveLabel(session.combat!,"willow-gate-rock-11-8")).toBe("파괴 목표 2 · 동쪽 피난문 바위");
  const before=summary();
  const projection=restoreCampaignSave(saveRecord(session),context).projection;
  session=act(createResumedSessionCoreState({sessionId:"gate-resume",playerId:"host",displayName:"Host"},projection,context),{type:"resume-adventure"});
  expect(summary()).toEqual(before);
  expect(destructionObjectives({...session.combat!,rules:undefined})).toEqual([]);
});
