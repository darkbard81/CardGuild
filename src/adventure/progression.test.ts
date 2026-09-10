import { describe, expect, it } from "vitest";
import { PRODUCTION_CONTENT } from "../content/production-content";
import {
  chooseAiCommand, createCombat, createCombatReplay, dispatchCombatCommand, hashCombatState, replayCombat,
  resolveArmorClass, resolveClassDC, resolveStatisticDC, resolveStatisticModifier, resolveStrike,
  SAVE_IDS, SKILL_IDS, type ActorState,
  gridDistance, listLegalActions, listLegalTargets, type CombatState, type CombatCommand,
} from "../game";
import { deriveActorSetup, deriveLoadoutSnapshot, previewLoadoutChange } from "../loadout";
import {
  assertAdventureInvariants, assertCharacterProgression, buildAdventureEncounter, createAdventureSession,
  createCharacterProgression, dispatchAdventureCommand, resolveEffectiveCharacterStatProfile,
  type AdventureCommand, type AdventureState, type CharacterProgressionState, type PartySetup,
} from ".";

const { pack, adventure: definition } = PRODUCTION_CONTENT;
const context = { definition, actorDefinitions: pack.actorDefinitions, combatContent: pack.combatContent };
const aerin = pack.actorDefinitions["hero.aerin"]!;
function setup(ids = [aerin.id]): PartySetup {
  return { members: Object.fromEntries(ids.map((id, index) => {
    const memberId = `party.hero-${index + 1}`;
    return [memberId, { id: memberId, seat: (index + 1) as 1 | 2 | 3, actorDefinitionId: id, loadout: pack.actorDefinitions[id]!.starterLoadout }];
  })) };
}
function ready(ids?: string[]): AdventureState { return createAdventureSession(context, setup(ids), 1); }
function progression(state: AdventureState, value: CharacterProgressionState): AdventureState {
  return { ...state, party: { members: Object.fromEntries(Object.entries(state.party.members)
    .map(([id, member]) => [id, { ...member, progression: { ...value } }])) } };
}
function dispatch(state: AdventureState, command: AdventureCommand): AdventureState {
  const result = dispatchAdventureCommand(state, command, context);
  expect(result.accepted, result.error).toBe(true);
  return result.state;
}
function start(state: AdventureState): AdventureState {
  return dispatch(dispatch(state, { type: "start-adventure" }), { type: "start-encounter" });
}
function combat(state: AdventureState) {
  const encounter = buildAdventureEncounter(pack, state);
  return { encounter, state: createCombat(encounter.definition, encounter.seed).state };
}

/** Only legal player inputs; enemy decisions still come from the production AI. */
function playCommand(state: CombatState): CombatCommand {
  const sequence = state.sequence + 1;
  const base = { id: `progression-test-${sequence}`, sequence, actorId: state.turn.activeActorId };
  if (state.pendingReaction) return { ...base, actorId: state.pendingReaction.candidates[0]!.actorId,
    type: "pass-reaction", triggerId: state.pendingReaction.triggerId };
  const enemyCommand = chooseAiCommand(state, pack.combatContent);
  if (enemyCommand) return enemyCommand;
  const actor = state.actors[base.actorId]!;
  const actions = listLegalActions(state, actor.id, pack.combatContent).filter(action => action.enabled);
  const strike = actions.find(action => action.source.kind === "basic" && action.actionId === "strike");
  const target = strike && listLegalTargets(state, actor.id, strike.source, pack.combatContent)
    .find(target => target.kind === "actor" && state.actors[target.actorId]!.team === "enemies");
  if (strike && target?.kind === "actor") return { ...base, type: "use-action", action: strike.source, target: { kind: "actor", actorId: target.actorId } };
  const stride = actions.find(action => action.actionId === "stride");
  const enemy = Object.values(state.actors).filter(a => a.team === "enemies" && !a.defeated)
    .sort((a, b) => gridDistance(actor.position, a.position) - gridDistance(actor.position, b.position))[0];
  if (stride && enemy) {
    const tile = listLegalTargets(state, actor.id, stride.source, pack.combatContent)
      .filter(target => target.kind === "tile")
      .sort((a, b) => gridDistance(a.position, enemy.position) - gridDistance(b.position, enemy.position) || a.costFeet - b.costFeet)[0];
    if (tile && gridDistance(tile.position, enemy.position) < gridDistance(actor.position, enemy.position)) {
      return { ...base, type: "use-action", action: stride.source, target: { kind: "tile", position: tile.position } };
    }
  }
  return { ...base, type: "end-turn", facing: actor.facing };
}

// Exact values are authored-profile regression oracles, not values calculated by the function under test.
const expected = [
  ["hero.aerin", 34, 19, 9, 17], ["hero.brom", 42, 21, 7, 17],
  ["hero.lyra", 26, 19, 8, 18], ["hero.nera", 28, 17, 6, 20],
] as const;

describe("M9-1 runtime progression", () => {
  it("initializes every new character from authored level with independent EXP state", () => {
    const input = setup([aerin.id, "hero.lyra"]);
    const before = structuredClone(input);
    const state = createAdventureSession(context, input, 1);
    expect(state.version).toBe(3);
    expect(input).toEqual(before);
    const members = Object.values(state.party.members);
    expect(members.map(m => m.progression)).toEqual([{ level: 1, experience: 0 }, { level: 1, experience: 0 }]);
    expect(members[0]!.progression).not.toBe(members[1]!.progression);
    const actor = { ...aerin, statProfile: resolveEffectiveCharacterStatProfile(aerin, { level: 3, experience: 0 }) };
    const custom = { ...context, actorDefinitions: { ...pack.actorDefinitions, [actor.id]: actor } };
    // New Adventure ignores any extra caller-supplied runtime fields, just as it ignores caller loadouts.
    const injected = { members: { ...input.members, "party.hero-1": { ...input.members["party.hero-1"]!, progression: { level: 9, experience: 999 } } } };
    expect(createAdventureSession(custom, injected, 1).party.members["party.hero-1"]!.progression).toEqual({ level: 3, experience: 0 });
    expect(aerin.statProfile).toMatchObject({ stats: { level: 1 } });
  });

  it("rejects invalid progression and v2 state without silently normalizing it", () => {
    const invalid: unknown[] = [undefined, null, {}, { level: 1 }, { experience: 0 }];
    for (const level of [0, -1, 1.5, NaN, Infinity, "2"]) invalid.push({ level, experience: 0 });
    for (const experience of [-1, 1000, 1001, 0.5, NaN, Infinity, "0"]) invalid.push({ level: 1, experience });
    for (const value of invalid) {
      expect(() => assertCharacterProgression(value)).toThrow();
      const broken = progression(ready(), value as CharacterProgressionState);
      // The spread above turns null/undefined into {}, which is still rejected.
      expect(() => assertAdventureInvariants(broken)).toThrow();
      expect(() => dispatchAdventureCommand(broken, { type: "start-adventure" }, context)).toThrow();
      expect(() => buildAdventureEncounter(pack, { ...broken, phase: "combat", currentEncounterId: definition.encounterIds[0]! })).toThrow();
    }
    for (const value of [{ level: 1, experience: 0 }, { level: 2, experience: 999 }, { level: 21, experience: 375 }]) {
      expect(() => assertCharacterProgression(value)).not.toThrow();
    }
    expect(() => assertAdventureInvariants({ ...ready(), version: 2 } as unknown as AdventureState)).toThrow("version 3");
    const creature = Object.values(pack.actorDefinitions).find(a => a.statProfile.kind === "creature")!;
    expect(() => createCharacterProgression(creature)).toThrow("Character profile");
    expect(() => resolveEffectiveCharacterStatProfile(creature, { level: 2, experience: 0 })).toThrow("Character profile");
    expect(() => createAdventureSession(context, setup([creature.id]), 1)).toThrow("Character profile");
  });

  it.each(expected)("uses runtime Level 2 throughout the %s combat and preview paths", (id, maxHp, ac, strike, classDc) => {
    const source = structuredClone(pack.actorDefinitions[id]!);
    const state = start(progression(ready([id]), { level: 2, experience: 375 }));
    const member = state.party.members["party.hero-1"]!;
    const actor = pack.actorDefinitions[id]!;
    const effective = resolveEffectiveCharacterStatProfile(actor, member.progression);
    const { state: battle } = combat(state);
    const hero = battle.actors[member.id]!;
    expect(hero.statProfile).toEqual(effective);
    expect(hero.hp).toBe(maxHp);
    expect(hero.maxHp).toBe(maxHp);
    expect(resolveArmorClass(hero, { content: pack.combatContent }).value).toBe(ac);
    expect(resolveStrike(hero, { content: pack.combatContent }).attackModifier).toBe(strike);
    expect(resolveClassDC(hero, { content: pack.combatContent }).value).toBe(classDc);
    const view = deriveLoadoutSnapshot(actor, member.loadout, pack.combatContent, member.id, effective);
    expect(view.statistics).toMatchObject({ maxHp, ac, classDc });
    expect(view.strike.attackModifier).toBe(strike);
    const preview = previewLoadoutChange(state.party, state.collection, pack, member.id, { ...member.loadout, equipment: {} }, effective);
    expect(preview.before).toEqual(view);
    expect(preview.after!.statistics.maxHp).toBe(maxHp);
    const candidateSetup = deriveActorSetup(actor, { instanceId: member.id, actorDefinitionId: id, team: "heroes", position: { x: 0, y: 0 }, facing: "north" },
      { ...member.loadout, equipment: {} }, pack.combatContent, member.id, effective);
    const candidate: ActorState = { ...candidateSetup, defeated: false, shieldRaised: false, reactionAvailable: false };
    expect(preview.after!.statistics.ac).toBe(resolveArmorClass(candidate, { content: pack.combatContent }).value);
    expect(preview.after!.strike).toEqual(resolveStrike(candidate, { content: pack.combatContent }));
    const baseline = combat(start(ready([id]))).state.actors[member.id]!;
    const selectors = [
      ...SAVE_IDS.map(save => ({ kind: "save", id: save } as const)),
      ...SKILL_IDS.map(skill => ({ kind: "skill", id: skill } as const)),
      { kind: "perception" } as const,
    ];
    for (const selector of selectors) {
      const rank = selector.kind === "save" ? effective.stats.saves[selector.id]
        : selector.kind === "skill" ? effective.stats.skills[selector.id] : effective.stats.perception;
      const difference = rank === "untrained" ? 0 : 1;
      expect(resolveStatisticModifier(hero, selector, { content: pack.combatContent }).value)
        .toBe(resolveStatisticModifier(baseline, selector, { content: pack.combatContent }).value + difference);
      expect(resolveStatisticDC(hero, selector, { content: pack.combatContent }).value)
        .toBe(resolveStatisticDC(baseline, selector, { content: pack.combatContent }).value + difference);
    }
    expect(pack.actorDefinitions[id]).toEqual(source);
    if (actor.statProfile.kind !== "character") throw new Error("Expected Character.");
    expect(effective.stats.attributes).not.toBe(actor.statProfile.stats.attributes);
    expect(effective.stats.defense.armorProficiencies).not.toBe(actor.statProfile.stats.defense.armorProficiencies);
    expect(effective.stats.offense.unarmedStrike).not.toBe(actor.statProfile.stats.offense.unarmedStrike);
    expect(hero.statProfile).not.toBe(effective);
  });

  it("keeps active and completed Combat immutable while the next encounter uses new progression", () => {
    const initial = start(ready());
    const old = combat(initial);
    const activeCopy = structuredClone(old.state);
    const activeHash = hashCombatState(old.state);
    const raised = progression(initial, { level: 2, experience: 375 });
    const next = combat(raised);
    expect(next.state.actors["party.hero-1"]!.maxHp).toBe(34);
    expect(old.state).toEqual(activeCopy);
    expect(hashCombatState(old.state)).toBe(activeHash);
    expect(next.state.setupFingerprint).not.toBe(old.state.setupFingerprint);
    for (const actor of Object.values(old.state.actors).filter(a => a.team !== "heroes")) {
      expect(next.state.actors[actor.id]!.statProfile).toEqual(actor.statProfile);
      expect(next.state.actors[actor.id]!.maxHp).toBe(actor.maxHp);
    }
    let finished = old.state;
    for (let index = 0; index < 1000 && !finished.outcome; index++) {
      const command = playCommand(finished);
      const result = dispatchCombatCommand(finished, command, pack.combatContent);
      expect(result.accepted, result.error).toBe(true);
      finished = result.state;
    }
    expect(finished.outcome).toBe("victory");
    const completedCopy = structuredClone(finished);
    const completedHash = hashCombatState(finished);
    let adventure = dispatch(initial, { type: "accept-combat-result", result: {
      encounterId: finished.scenarioId, combatSeed: finished.seed, finalCombatHash: completedHash, outcome: "victory",
    } });
    // The victory pays this Encounter's authored EXP; it is far short of the next Level.
    expect(adventure.party.members["party.hero-1"]!.progression).toEqual({ level: 1, experience: 200 });
    expect(adventure.party.members["party.hero-1"]!.loadout).toEqual(initial.party.members["party.hero-1"]!.loadout);
    adventure = progression(adventure, { level: 2, experience: 375 });
    if (adventure.pendingReward) adventure = dispatch(adventure, { type: "choose-reward", rewardId: adventure.pendingReward.rewardId, choiceIndex: 0 });
    const nextEncounter = combat(dispatch(adventure, { type: "continue-adventure" }));
    expect(nextEncounter.state.actors["party.hero-1"]!.hp).toBe(34);
    expect(finished).toEqual(completedCopy);
    expect(hashCombatState(replayCombat(old.encounter.definition, createCombatReplay(finished)).state)).toBe(completedHash);
    expect(hashCombatState(old.state)).toBe(activeHash);
  });

  it("preserves Level/EXP through loadout and defeat, and grows only on victory", () => {
    const state = progression(ready(), { level: 2, experience: 999 });
    const member = state.party.members["party.hero-1"]!;
    const changed = dispatch(state, { type: "set-member-loadout", memberId: member.id, loadout: member.loadout });
    expect(changed.party.members[member.id]!.progression).toEqual(member.progression);
    const active = start(changed);
    const encounter = buildAdventureEncounter(pack, active);
    const settle = (outcome: "victory" | "defeat"): AdventureState => {
      const result = dispatchAdventureCommand(active, { type: "accept-combat-result", result: {
        encounterId: active.currentEncounterId!, combatSeed: encounter.seed, outcome, finalCombatHash: "fixture",
      } }, context);
      expect(result.accepted, result.error).toBe(true);
      return result.state;
    };

    // Defeat pays nothing, so the run that ends here keeps exactly the Level it walked in with.
    expect(settle("defeat").party).toEqual(state.party);

    const won = dispatchAdventureCommand(active, { type: "accept-combat-result", result: {
      encounterId: active.currentEncounterId!, combatSeed: encounter.seed, outcome: "victory", finalCombatHash: "fixture",
    } }, context);
    expect(won.accepted, won.error).toBe(true);
    // 999 + 200 crosses the threshold once and carries the remainder.
    expect(won.state.party.members[member.id]!.progression).toEqual({ level: 3, experience: 199 });
    expect(won.events.map(event => event.type)).toEqual([
      "ENCOUNTER_COMPLETED", "EXPERIENCE_GAINED", "LEVEL_UP", "REWARD_OFFERED",
    ]);
    // Choosing the reward is a Collection change; it must not pay EXP a second time.
    const rewarded = dispatch(won.state, { type: "choose-reward", rewardId: won.state.pendingReward!.rewardId, choiceIndex: 0 });
    expect(rewarded.party.members[member.id]!.progression).toEqual({ level: 3, experience: 199 });
    // The same accepted result cannot be replayed into a second award.
    expect(dispatchAdventureCommand(won.state, { type: "accept-combat-result", result: {
      encounterId: active.currentEncounterId!, combatSeed: encounter.seed, outcome: "victory", finalCombatHash: "fixture",
    } }, context).accepted).toBe(false);
  });
});
