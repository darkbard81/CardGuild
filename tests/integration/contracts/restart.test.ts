import { expect, it } from "vitest";
import type { SessionCredentialResponse } from "../../../src/server/session-store";
import { api, PASSWORD, register, Wire } from "../../support/network";
import { productProcess } from "../../support/process";
import { HERO } from "../../support/session";

it.each(["SIGTERM", "SIGKILL"] as const)("B-RESUME %s of the built server preserves the approved checkpoint and permits the next legal action", async signal => {
  const server = await productProcess(); const wires: Wire[] = [];
  try {
    await server.start();
    const account = await register(server.origin, "restart-owner");
    const response = await api(server.origin, "/api/campaigns", { name: "Restart checkpoint" }, account.cookie);
    const created = await response.json() as SessionCredentialResponse & { campaign: { campaignId: string } };
    const client = await Wire.open(server.origin, created); wires.push(client);
    await client.snapshot();
    await client.intent({ type: "create-character", name: "Arlen", gender: "male", creationPresetId: "human.fighter" });
    const committed = await client.intent({ type: "set-loadout", memberId: HERO, loadout: { equipment: {}, preparedCards: [] } });
    await server.stop(signal);
    await server.start();
    const login = await api(server.origin, "/api/auth/login", { username: account.account.username, password: PASSWORD });
    expect(login.status).toBe(200);
    const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
    const continued = await api(server.origin, `/api/campaigns/${created.campaign.campaignId}/continue`, {}, cookie);
    expect(continued.status).toBe(200);
    const credential = await continued.json() as SessionCredentialResponse;
    const resumed = await Wire.open(server.origin, credential); wires.push(resumed);
    const checkpoint = await resumed.snapshot();
    expect(checkpoint.state.lifecycle).toBe("resume-lobby");
    expect(checkpoint.gameplayHash).toBe(committed.gameplayHash);
    expect(credential.sessionId).not.toBe(created.sessionId);
    await resumed.intent({ type: "resume-adventure" });
    const playing = await resumed.intent({ type: "start-encounter" });
    expect(playing.state.adventure?.phase).toBe("combat");
    expect(playing.state.combat).not.toBeNull();
  } catch (error) {
    throw new Error(`B-RESUME seed 60; built server log:\n${server.log}`, { cause: error });
  } finally { await Promise.all(wires.map(wire => wire.close())); await server.dispose(); }
});
