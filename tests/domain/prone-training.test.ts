import { expect, it } from "vitest";
import { buildAdventureEncounter } from "../../src/adventure";
import { createCombatReplay, hashCombatState, replayCombat } from "../../src/game/replay";
import { listLegalActions, listLegalTargets } from "../../src/game/queries";
import { createCampaignSave, restoreCampaignSave } from "../../src/server/campaign-save";
import { createResumedSessionCoreState, dispatchSessionIntent } from "../../src/session";
import { HERO, saveRecord } from "../support/session";
import { trainingReady, tutorialAct as act, tutorialContext as context, resolveOpening, tutorialWin, recruitedParty } from "../support/tutorial";

it("G-PRONE all production presets and seeds commit the authored opening, gate, Ring Stand and replay", () => {
  for (const preset of Object.keys(context.pack.creationPresets!)) for (const gender of ["female", "male"] as const) for (const seed of [1, 3, 17, 60, 68, 999]) {
    const setup = act(trainingReady(seed, preset, gender), { type: "start-encounter" });
    expect(setup.combat!.turn.activeActorId, `${preset}/${gender}/${seed}`).toBe("android-trainee");
    const enemy = setup.combat!.actors["android-trainee"]!;
    expect(enemy.statProfile.kind === "creature" && enemy.statProfile.stats.level).toBe(-1);
    expect(setup.combat!.partyHpFloor).toBe(1);
    const applied = resolveOpening(setup);
    let state = applied.state;
    expect(state.combat!.actors[HERO]!.conditions.some(c => c.id === "prone")).toBe(true);
    expect(state.combat!.opening!.phase).toBe("dialogue");
    expect(applied.events.some(e => e.type === "CHECK_ROLLED" && e.degree === "success" && e.rolledDegree)).toBe(true);
    expect(resolveOpeningSafely(state)).toBe(false);
    state = act(state, { type: "complete-scene", sceneId: "guild-prone-recovery" });
    expect(state.combat!.turn.activeActorId).toBe(HERO);
    expect(state.combat!.actors[HERO]!.conditions.some(c => c.id === "prone")).toBe(true);
    const content = context.pack.combatContent;
    expect(listLegalTargets(state.combat!, HERO, { kind: "basic", id: "stride" }, content)).toHaveLength(0);
    expect(listLegalActions(state.combat!, HERO, content).find(a => a.actionId === "stand")?.enabled).toBe(true);
    state = act(state, { type: "use-action", action: { kind: "context", id: "stand" }, target: { kind: "none" } });
    expect(state.combat!.turn.actionsRemaining).toBe(2);
    expect(state.combat!.actors[HERO]!.conditions.some(c => c.id === "prone")).toBe(false);
    state = act(state, { type: "end-turn", facing: "east" });
    expect(state.combat!.round).toBe(2);
    expect(state.combat!.turn.initiativeOrder).toEqual(state.combat!.opening!.regularInitiativeOrder);
    const definition = buildAdventureEncounter(context.pack, setup.adventure!).definition;
    expect(hashCombatState(replayCombat(definition, createCombatReplay(state.combat!)).state)).toBe(hashCombatState(state.combat!));
  }
});
function resolveOpeningSafely(state: ReturnType<typeof trainingReady>) {
  return dispatchSessionIntent(state, "host", { type: "end-turn", facing: "east" }, context, {
    connectedPlayerIds: ["host"], effectiveControllerByMemberId: { [HERO]: "host" },
  }).accepted;
}
it("G-PRONE saves preserve pending and settled gates, reject forged progress and recruit Aerin atomically", () => {
  const setup = act(trainingReady(), { type: "start-encounter" });
  const pending = resolveOpening(setup).state;
  expect(dispatchSessionIntent(pending, "guest", { type: "complete-scene", sceneId: "guild-prone-recovery" }, context, { connectedPlayerIds: ["host"], effectiveControllerByMemberId: { [HERO]: "host" } }).accepted).toBe(false);
  const settled = act(pending, { type: "complete-scene", sceneId: "guild-prone-recovery" });
  for (const state of [setup, pending, settled]) {
    const restored = restoreCampaignSave(saveRecord(state), context).projection;
    const resumed = createResumedSessionCoreState({ sessionId: "resumed", playerId: "host", displayName: "Host" }, restored, context);
    expect(act(resumed, { type: "resume-adventure" }).combat).toEqual(state.combat);
  }
  const forged = { ...pending, combat: { ...pending.combat!, opening: { ...pending.combat!.opening!, phase: "complete" as const } } };
  expect(() => restoreCampaignSave(saveRecord(forged), context)).toThrow();
  expect(createCampaignSave(settled).combat!.commandLog.filter(c => c.type === "complete-scene")).toHaveLength(1);
  const won = tutorialWin(settled);
  expect(won.adventure!.pendingReward!.choices).toEqual([{ kind: "companion", definitionId: "companion.aerin" }]);
  const recruited = recruitedParty();
  expect(Object.values(recruited.adventure!.party.members).map(m => m.actorDefinitionId)).toContain("hero.aerin");
  expect(recruited.partySlots).toHaveLength(2);
  restoreCampaignSave(saveRecord(recruited), context);
});
