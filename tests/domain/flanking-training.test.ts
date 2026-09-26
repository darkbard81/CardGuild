import { expect, it } from "vitest";
import { buildAdventureEncounter } from "../../src/adventure";
import { createCombat, createCombatReplay, dispatchCombatCommand, hashCombatState, previewAction, replayCombat, type CombatState } from "../../src/game";
import { resolveOffGuardTo } from "../../src/game/off-guard";
import { restoreCampaignSave } from "../../src/server/campaign-save";
import { dispatchSessionIntent } from "../../src/session";
import { command, play } from "../support/combat";
import { HERO, SECOND, saveRecord } from "../support/session";
import { recruitedParty, trainingReady, tutorialAct as act, tutorialContext as context, tutorialWin } from "../support/tutorial";

const enemy = "android-trainee";
const target = { kind: "actor", actorId: enemy } as const;
const strike = { kind: "basic", id: "strike" } as const;
function setup(preset = "human.fighter", seed = 69) {
  let ready = recruitedParty(seed, preset);
  if (preset === "human.ranger") {
    const loadout = ready.adventure!.party.members[HERO]!.loadout;
    const equipment = { ...loadout.equipment };
    delete equipment.weapon;
    ready = act(ready, { type: "set-loadout", memberId: HERO, loadout: { ...loadout, equipment } });
  }
  const started = act(ready, { type: "start-encounter" });
  return { ready, started, definition: buildAdventureEncounter(context.pack, started.adventure!).definition };
}
function turnTo(state: CombatState, id: string, definition: ReturnType<typeof setup>["definition"]) {
  for (let i = 0; i < 3 && state.turn.activeActorId !== id; i++) state = play(state, {
    type: "end-turn", actorId: state.turn.activeActorId,
    facing: state.actors[state.turn.activeActorId]!.facing,
  }, definition);
  expect(state.turn.activeActorId).toBe(id);
  return state;
}

it("G-FLANK authored two-member training has multiple real movement solutions for every starting class, live previews and replay", () => {
  for (const preset of Object.keys(context.pack.creationPresets!)) for (const route of [0, 1]) {
    const { started, definition } = setup(preset);
    let state = started.combat!;
    expect(state.scenarioId).toBe("encounter.flanking-training");
    expect(state.actors[enemy]!.definitionId).toBe("enemy.android-trainee");
    expect(state.partyHpFloor).toBe(1);
    expect(state.rules?.partySize).toEqual({ min: 2, max: 2 });
    expect(state.actors[SECOND]!.definitionId).toBe("hero.aerin");
    for (const id of [HERO, SECOND]) expect(resolveOffGuardTo(state, state.actors[id]!, state.actors[enemy]!, { content: definition.content }).causes).not.toContain("flanking");
    const mover = SECOND;
    if (route === 1) {
      state = turnTo(state, HERO, definition);
      state = play(state, { type: "use-action", actorId: HERO, action: { kind: "basic", id: "stride" }, target: { kind: "tile", position: { x: 1, y: 2 } } }, definition);
      state = play(state, { type: "end-turn", actorId: HERO, facing: "north" }, definition);
    }
    state = turnTo(state, mover, definition);
    const destination = route === 0 ? { x: 2, y: 1 } : { x: 1, y: 0 };
    state = play(state, { type: "use-action", actorId: mover, action: { kind: "basic", id: "stride" }, target: { kind: "tile", position: destination } }, definition);
    state = play(state, { type: "use-action", actorId: mover, action: { kind: "basic", id: "step" }, target: { kind: "tile", position: destination, facing: route === 0 ? "west" : "south" } }, definition);
    const preview = previewAction(state, mover, strike, target, definition.content);
    expect(preview.legal, `${preset}/${mover}: ${preview.reason}`).toBe(true);
    expect(preview.tactical?.causes).toContain("flanking");
    expect(preview.tactical?.partnerIds).toEqual([HERO]);
    expect(preview.tactical?.ac).toBe(10);
    expect(preview.damageRange![0]).toBeGreaterThan(0);
    expect(preview.damagePrevention).toBeUndefined();
    expect(state.actors[enemy]!.conditions).toEqual([]);
    const broken = play(state, { type: "use-action", actorId: mover, action: { kind: "basic", id: "stride" }, target: { kind: "tile", position: { x: 0, y: 2 } } }, definition);
    expect(resolveOffGuardTo(broken, broken.actors[mover]!, broken.actors[enemy]!, { content: definition.content }).causes).not.toContain("flanking");
    expect(hashCombatState(replayCombat(definition, createCombatReplay(broken)).state)).toBe(hashCombatState(broken));
  }
});

it("G-FLANK all damage paths obey immunity; rear or Prone alone never bypass it; ordinary encounters retain damage", () => {
  // Public combat setup isolates attack/check/direct damage from turn sequencing and RNG luck.
  for (const id of ["strike", "force-barrage", "frostbite"]) for (const mode of ["protected", "flanking", "ordinary"] as const) {
    const { definition: base } = setup(id === "frostbite" ? "human.druid" : "human.wizard");
    const definition = { ...base, scenario: { ...base.scenario,
      rules: mode === "ordinary" ? undefined : base.scenario.rules,
      actors: base.scenario.actors.map(a => a.id === HERO ? a
        : a.id === SECOND ? { ...a, position: mode === "flanking" ? { x: 2, y: 1 } : a.position, facing: "west" as const }
        : { ...a, facing: "east" as const, conditions: [{ id: "prone", sourceId: "precondition" }] }),
    } };
    let damaged = false;
    for (let seed = 1; seed <= 12; seed++) {
      const state = turnTo(createCombat(definition, seed).state, HERO, definition);
      const action = id === "strike" ? strike : { kind: "card" as const, id: state.cardZones[HERO]!.hand.find(c => c.definitionId === `card.${id}`)!.id };
      const before = previewAction(state, HERO, action, target, definition.content);
      expect(before.legal, `${id}/${mode}: ${before.reason}`).toBe(true);
      expect(before.damagePrevention).toBe(mode === "protected" ? "requires-flanking" : undefined);
      if (id === "strike" && mode === "protected") expect(before.damageRange).toEqual([0, 0]);
      const result = dispatchCombatCommand(state, command(state, { type: "use-action", actorId: HERO, action, target }), definition.content);
      expect(result.accepted, `${id}/${mode}/${seed}: ${result.error}`).toBe(true);
      const events = result.events.filter(e => e.type === "DAMAGE_DEALT");
      if (events.length) damaged = true;
      for (const event of events) {
        if (mode === "protected") expect(event.amount, `${id}/${mode}/${seed}`).toBe(0);
        if (mode !== "protected") expect(event.amount).toBeGreaterThan(0);
        expect(event.preventedBy).toBe(mode === "protected" ? "requires-flanking" : undefined);
      }
      if (mode === "protected") expect(result.state.actors[enemy]!.hp).toBe(state.actors[enemy]!.hp);
      expect(result.state.turn.actionsRemaining).toBeLessThan(state.turn.actionsRemaining);
      expect(result.state.rng).not.toEqual(state.rng);
      expect(hashCombatState(replayCombat(definition, createCombatReplay(result.state)).state)).toBe(hashCombatState(result.state));
    }
    expect(damaged, `${id}/${mode}`).toBe(true);
  }
});

it("G-FLANK admission rejects wrong party sizes and ranged deadlock, preserves recruitment, save rules and the unprotected next battle", () => {
  const ready = recruitedParty();
  const dispatch = (state: typeof ready) => dispatchSessionIntent(state, "host", { type: "start-encounter" }, context, {
    connectedPlayerIds: ["host"], effectiveControllerByMemberId: Object.fromEntries(state.partySlots.map(s => [s.memberId, "host"])),
  });
  for (const size of [1, 3]) {
    const members = { ...ready.adventure!.party.members };
    if (size === 1) delete members[SECOND];
    else members["extra"] = { ...members[SECOND]!, id: "extra", seat: 3 };
    expect(() => buildAdventureEncounter(context.pack, { ...ready.adventure!, phase: "combat", party: { members } })).toThrow();
  }
  expect(dispatch(tutorialWin(trainingReady())).accepted).toBe(false); // Unsettled recruitment cannot depart.
  expect(dispatch(recruitedParty(69, "human.ranger")).error).toContain("활을 해제");
  expect(setup("human.ranger").started.combat).not.toBeNull();
  const { started, definition } = setup();
  let combat = turnTo(started.combat!, HERO, definition);
  combat = play(combat, { type: "use-action", actorId: HERO, action: strike, target }, definition);
  const saved = { ...started, combat };
  expect(restoreCampaignSave(saveRecord(saved), context).projection.combat).toEqual(combat);
  const forged = { ...saved, combat: { ...combat, rules: { ...combat.rules, damageRequiresFlanking: undefined } } };
  expect(() => restoreCampaignSave(saveRecord(forged), context)).toThrow();
  const won = tutorialWin(started);
  expect(won.adventure!.currentEncounterId).toBe("encounter.spear-line");
  const next = act(won, { type: "start-encounter" });
  expect(next.combat!.partyHpFloor).toBeUndefined();
  expect(next.combat!.rules?.damageRequiresFlanking).toBeUndefined();
});


it("G-FLANK enemy damage is not immunized and both actual party members retain HP 1 protection", () => {
  const { definition: base } = setup();
  const definition = { ...base, scenario: { ...base.scenario, actors: base.scenario.actors.map(a =>
    a.team === "heroes" ? { ...a, hp: 1, position: { x: a.id === HERO ? 0 : 1, y: a.id === HERO ? 1 : 0 } } : a) } };
  for (const id of [HERO, SECOND]) {
    let damageObserved = false;
    for (let seed = 1; seed <= 12; seed++) {
      const state = turnTo(createCombat(definition, seed).state, enemy, definition);
      const result = dispatchCombatCommand(state, command(state, { type: "use-action", actorId: enemy, action: strike, target: { kind: "actor", actorId: id } }), definition.content);
      expect(result.accepted).toBe(true);
      for (const event of result.events) if (event.type === "DAMAGE_DEALT") {
        damageObserved = true;
        expect(event.preventedBy).toBeUndefined();
        expect(event.amount).toBe(0);
      }
      expect(result.state.actors[id]!.hp).toBe(1);
      expect(result.state.actors[id]!.defeated).toBe(false);
    }
    expect(damageObserved).toBe(true);
  }
});
