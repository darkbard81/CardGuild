import { expect, it } from "vitest";
import { buildAdventureEncounter } from "../../src/adventure";
import { canInspectActor, createCombatReplay, dispatchCombatCommand, hashCombatState, replayCombat, previewAction } from "../../src/game";
import { restoreCampaignSave } from "../../src/server/campaign-save";
import { createResumedSessionCoreState } from "../../src/session";
import { FIRST_BATTLE_SCENE } from "../../src/scene/catalog";
import { command, play } from "../support/combat";
import { HERO, saveRecord } from "../support/session";
import { recruitedParty, tutorialStart, tutorialWin, tutorialAct as act, tutorialContext as context } from "../support/tutorial";

const target = { kind: "actor", actorId: "android-trainee" } as const;
const action = { kind: "basic", id: "recall-knowledge" } as const;
it("G-KNOWLEDGE-TRAINING four Android encounters bound protection, capabilities and temporary weapons", () => {
  const pack = context.pack;
  const ids = pack.adventures[context.adventureId]!.encounterIds;
  expect(ids.slice(0, 5)).toEqual(["encounter.guild-practice", "encounter.prone-training", "encounter.flanking-training", "encounter.knowledge-training", "encounter.willow-rescue"]);
  for (const [index, id] of ids.entries()) {
    const s = pack.scenarioSources[id]!;
    expect(s.partyHpFloor).toBe(index < 4 ? 1 : undefined);
    if (index < 4) expect(s.placements.map(p => p.actorDefinitionId)).toEqual(["enemy.android-trainee"]);
    expect(Boolean(s.rules?.partyWeaponOverride)).toBe(index === 2);
    expect(Boolean(s.rules?.damageRequiresFlanking)).toBe(index === 2);
    expect(Boolean(s.rules?.guaranteedCheck)).toBe(index === 3);
  }
  const first = act(tutorialStart(), { type: "start-encounter" }).combat!;
  expect(first.actors[target.actorId]!.innateActionIds).toEqual([]);
  expect(first.opening).toBeUndefined();
  expect(FIRST_BATTLE_SCENE.lines.map(l => l.text).join()).not.toMatch(/슬라임|Slime|세 연습/);
  const ready = tutorialWin(recruitedParty(70, "human.ranger"));
  const started = act(ready, { type: "start-encounter" });
  expect(started.combat!.actors[HERO]!.equipmentIds).toContain(ready.adventure!.party.members[HERO]!.loadout.equipment.weapon);
  expect(started.combat!.actors[HERO]!.equipmentIds).not.toContain("training-dagger");
  const next = act(tutorialWin(started), { type: "start-encounter" });
  expect(next.combat!.scenarioId).toBe("encounter.willow-rescue");
  expect(next.combat!.partyHpFloor).toBeUndefined();
  expect(next.combat!.rules).toBeUndefined();
});

it("G-KNOWLEDGE-TRAINING all presets roll naturally, consume one guarantee, unlock and preserve replay/save/Resume", () => {
  const degrees = new Set<string>();
  const rolls = new Set<number>();
  for (const preset of Object.keys(context.pack.creationPresets!)) for (const seed of [1, 2, 3, 4, 5, 6, 15]) {
    const started = act(tutorialWin(recruitedParty(seed, preset)), { type: "start-encounter" });
    const definition = buildAdventureEncounter(context.pack, started.adventure!).definition;
    let state = started.combat!;
    for (let i = 0; i < 3 && state.turn.activeActorId !== HERO; i++) state = play(state, { type: "end-turn", actorId: state.turn.activeActorId, facing: state.actors[state.turn.activeActorId]!.facing }, definition);
    expect(canInspectActor(state, target.actorId)).toBe(false);
    expect(state.guaranteedCheckConsumed).toBe(false);
    const result = dispatchCombatCommand(state, command(state, { type: "use-action", actorId: HERO, action, target }), definition.content);
    expect(result.accepted, `${preset}/${seed}: ${result.error}`).toBe(true);
    const check = result.events.find(e => e.type === "CHECK_ROLLED")!;
    expect(check.degree).toBe("success");
    expect(check.rolledDegree).toBeDefined();
    degrees.add(check.rolledDegree!); rolls.add(check.roll);
    expect(result.state.rng).not.toEqual(state.rng);
    expect(result.state.turn.actionsRemaining).toBe(state.turn.actionsRemaining - 1);
    expect(result.events).toContainEqual({ type: "KNOWLEDGE_RECALLED", actorId: HERO, targetId: target.actorId, success: true });
    expect(canInspectActor(result.state, target.actorId)).toBe(true);
    expect(result.state.guaranteedCheckConsumed).toBe(true);
    expect(previewAction(result.state, HERO, action, target, definition.content).legal).toBe(false);
    expect(hashCombatState(replayCombat(definition, createCombatReplay(result.state)).state)).toBe(hashCombatState(result.state));
    const restored = restoreCampaignSave(saveRecord({ ...started, combat: result.state }), context).projection;
    const resumed = act(createResumedSessionCoreState({ sessionId: "knowledge-resume", playerId: "host", displayName: "Host" }, restored, context), { type: "resume-adventure" });
    expect(resumed.combat).toEqual(result.state);
    expect(dispatchCombatCommand(resumed.combat!, command(resumed.combat!, { type: "use-action", actorId: HERO, action, target }), definition.content).accepted).toBe(false);
    expect(() => restoreCampaignSave(saveRecord({ ...started, combat: { ...result.state, guaranteedCheckConsumed: false } }), context)).toThrow();
  }
  expect(degrees).toContain("failure"); expect(degrees).toContain("critical-failure");
  expect(rolls.size).toBeGreaterThan(5);
});

it("G-KNOWLEDGE-TRAINING generic guarantee expires after one failed check; Willow rescue checks remain natural", async () => {
  const { createCombat } = await import("../../src/game");
  const ready = tutorialWin(recruitedParty(15, "human.wizard"));
  const started = act(ready, { type: "start-encounter" });
  const base = buildAdventureEncounter(context.pack, started.adventure!).definition;
  const definition = { ...base, scenario: { ...base.scenario, rules: { ...base.scenario.rules,
    guaranteedCheck: { ...base.scenario.rules!.guaranteedCheck!, degree: "failure" as const },
  } } };
  let state = createCombat(definition, 15).state;
  const nextHero = () => {
    for (let i = 0; i < 3 && state.actors[state.turn.activeActorId]!.team !== "heroes"; i++) state = play(state, { type: "end-turn", actorId: state.turn.activeActorId, facing: state.actors[state.turn.activeActorId]!.facing }, definition);
  };
  nextHero();
  const first = dispatchCombatCommand(state, command(state, { type: "use-action", actorId: state.turn.activeActorId, action, target }), definition.content);
  expect(first.accepted).toBe(true);
  expect(first.events.find(e => e.type === "CHECK_ROLLED")).toMatchObject({ degree: "failure", rolledDegree: expect.any(String) });
  state = play(first.state, { type: "end-turn", actorId: state.turn.activeActorId, facing: state.actors[state.turn.activeActorId]!.facing }, definition);
  nextHero();
  const second = dispatchCombatCommand(state, command(state, { type: "use-action", actorId: state.turn.activeActorId, action, target }), definition.content);
  expect(second.accepted).toBe(true);
  expect(second.events.find(e => e.type === "CHECK_ROLLED")!.rolledDegree).toBeUndefined();
  expect(replayCombat(definition, createCombatReplay(second.state)).state).toEqual(second.state);
  const ordinary = act(tutorialWin(started), { type: "start-encounter" });
  const normal = buildAdventureEncounter(context.pack, ordinary.adventure!).definition;
  let combat = ordinary.combat!;
  for (let i = 0; i < 6 && combat.turn.activeActorId !== HERO; i++) combat = play(combat, { type: "end-turn", actorId: combat.turn.activeActorId, facing: combat.actors[combat.turn.activeActorId]!.facing }, normal);
  combat = play(combat, { type: "use-action", actorId: HERO, action: { kind: "basic", id: "stride" }, target: { kind: "tile", position: { x: 10, y: 14 } } }, normal);
  const enemy = Object.values(combat.actors).find(a => a.definitionId === "enemy.dark-elf-warrior")!;
  const result = dispatchCombatCommand(combat, command(combat, { type: "use-action", actorId: HERO, action, target: { kind: "actor", actorId: enemy.id } }), normal.content);
  expect(result.accepted).toBe(true);
  expect(result.events.find(e => e.type === "CHECK_ROLLED")!.rolledDegree).toBeUndefined();
});

it("G-KNOWLEDGE-TRAINING invalid guarantee and capability references fail authoring", async () => {
  const { compileContentPack } = await import("../../src/content/compile-content");
  const { M7_CONTENT_SOURCE } = await import("../../src/content/load-m7-content");
  for (const rules of [
    { guaranteedCheck: { actionId: "stride", targetActorId: "android-trainee", degree: "success" as const, uses: 1 as const } },
    { guaranteedCheck: { actionId: "recall-knowledge", targetActorId: "missing", degree: "success" as const, uses: 1 as const } },
    { innateActionOverride: { actorId: "missing", actionIds: [] } },
    { innateActionOverride: { actorId: "android-trainee", actionIds: ["missing"] } },
  ]) expect(() => compileContentPack({ ...M7_CONTENT_SOURCE, scenarios: M7_CONTENT_SOURCE.scenarios.map(s => s.id === "encounter.knowledge-training" ? { ...s, rules } : s) })).toThrow();
});
