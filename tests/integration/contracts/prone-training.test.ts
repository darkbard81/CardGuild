import { expect, it } from "vitest";
import { SessionHost } from "../../../src/server/session-host";
import { createReconnectCredential } from "../../../src/server/credentials";
import { createResumedSessionCoreState, type SessionCoreState } from "../../../src/session";
import { restoreCampaignSave } from "../../../src/server/campaign-save";
import { envelope, mailbox } from "../../support/host";
import { saveRecord } from "../../support/session";
import { trainingReady, tutorialContext } from "../../support/tutorial";

it.each(["pending", "dialogue"] as const)("B-PRONE %s save: server commits Trip before gate and Resume never repeats it", async phase => {
  const credential = createReconnectCredential();
  const commits: string[] = [];
  const checkpoints: SessionCoreState[] = [];
  const host = new SessionHost(trainingReady(), tutorialContext, credential.digest, {
    durability: { async commitGameplayTransition(_before, after) { commits.push(after.combat?.opening?.phase ?? "none"); checkpoints.push(after); } },
  });
  const box = mailbox();
  await host.attach("host", credential.token, host.state.contentIdentity, box.connection);
  await host.handleIntent("host", box.connection.id, envelope(host.state, { type: "start-encounter" }));
  expect(commits).toEqual(["pending", "dialogue"]);
  expect(host.state.combat!.commandLog).toHaveLength(1);
  const restored = restoreCampaignSave(saveRecord(checkpoints.find(s => s.combat?.opening?.phase === phase)!), tutorialContext).projection;
  const resumed = new SessionHost(createResumedSessionCoreState({ sessionId: "resumed", playerId: "host", displayName: "Host" }, restored, tutorialContext), tutorialContext, credential.digest);
  await resumed.attach("host", credential.token, resumed.state.contentIdentity, box.connection);
  await resumed.handleIntent("host", box.connection.id, envelope(resumed.state, { type: "resume-adventure" }));
  expect(resumed.state.combat!.commandLog).toHaveLength(1);
  const completion = envelope(resumed.state, { type: "complete-scene", sceneId: "guild-prone-recovery" });
  await resumed.handleIntent("host", box.connection.id, completion);
  await resumed.handleIntent("host", box.connection.id, completion);
  expect(resumed.state.combat!.commandLog).toHaveLength(2);
  expect(resumed.state.combat!.opening!.phase).toBe("complete");
  expect(resumed.state.combat!.actors["party.hero-1"]!.conditions.some(c => c.id === "prone")).toBe(true);
});
