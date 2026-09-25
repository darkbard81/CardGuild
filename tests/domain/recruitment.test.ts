import { expect, it } from "vitest";
import { applyExperience, assertAdventureCharacterInvariants, deriveCombatSeed, dispatchAdventureCommand } from "../../src/adventure";
import { createCompanionMember } from "../../src/adventure/recruitment";
import { M7_CONTENT_SOURCE } from "../../src/content/load-m7-content";
import { isCharacterActorSource } from "../../src/content/content-types";
import { compileContentPack } from "../../src/content/compile-content";
import { createCampaignSave, restoreCampaignSave } from "../../src/server/campaign-save";
import { SessionHost } from "../../src/server/session-host";
import { createResumedSessionCoreState, joinSessionCore } from "../../src/session";
import { validateSnapshotState } from "../../src/protocol/validate-snapshot";
import { PROTOCOL_VERSION, type ServerSnapshot } from "../../src/protocol";
import { HERO, SECOND, saveRecord } from "../support/session";
import { recruitIntent, recruitmentAct as act, recruitmentContext as context, recruitmentDispatch, recruitmentReward, recruitmentRuntime as runtime, recruitmentStart } from "../support/recruitment";

it("G-RECRUIT seed=65 appends same-Class Aerin once, preserves current gear/growth/inventory and pays only new starter ownership", () => {
  const started = recruitmentStart();
  expect(Object.keys(started.adventure!.party.members)).toEqual([HERO]);
  const initial = recruitmentReward();
  const oldHero = initial.adventure!.party.members[HERO]!;
  const hero = { ...oldHero, loadout: { equipment: {}, preparedCards: [] }, progression: applyExperience(oldHero.progression, 1000).progression };
  const before: typeof initial = { ...initial, adventure: { ...initial.adventure!, party: { members: { [HERO]: hero } },
    collection: { equipment: { ...initial.adventure!.collection.equipment, greatsword: 2 }, cards: { ...initial.adventure!.collection.cards, "card.trip": 3 } } } };
  const original = structuredClone(before);
  const result = recruitmentDispatch(before, recruitIntent);
  expect(result.accepted).toBe(true);
  const after = result.state;
  const member = after.adventure!.party.members[SECOND]!;
  expect(after.adventure!.party.members[HERO]).toEqual(hero);
  expect(member).toMatchObject({ id: SECOND, seat: 2, actorDefinitionId: "hero.aerin", identity: { origin: "companion", recruitmentSource: recruitIntent.rewardId }, progression: { level: 1, experience: 0, advancements: [] } });
  const starter = { equipment: { halberd: 1, "scale-mail": 1, shield: 1 },
    cards: { "card.vicious-swing": 1 } };
  for (const kind of ["equipment", "cards"] as const) {
    const expected: Record<string, number> = { ...before.adventure.collection[kind] };
    for (const [id, count] of Object.entries(starter[kind])) expected[id] = (expected[id] ?? 0) + count;
    expect(after.adventure!.collection[kind]).toEqual(expected);
  }
  expect(after.adventure!.collection.cards["card.reactive-strike"]).toBe(before.adventure.collection.cards["card.reactive-strike"]);
  expect(after.adventure!.collection.cards["card.fly"]).toBe(before.adventure.collection.cards["card.fly"]);
  expect(after.partySlots).toEqual([...before.partySlots, { slot: 2, memberId: SECOND, actorDefinitionId: "hero.aerin" }]);
  expect(after.guestClaims).toEqual(before.guestClaims);
  expect(after.seats).toEqual(before.seats);
  expect(after.adventure).toMatchObject({ phase: "between-encounters", pendingReward: null, currentEncounterId: "encounter.spear-line" });
  expect(result.events).toContainEqual({ type: "COMPANION_RECRUITED", memberId: SECOND, definitionId: "companion.aerin", rewardId: recruitIntent.rewardId });
  const duplicate = recruitmentDispatch(after, recruitIntent);
  expect(duplicate.accepted).toBe(false); expect(duplicate.state).toBe(after);
  expect(before).toEqual(original);
});

it.each(["creation-template", "authored-recruitment-party"] as const)("G-RECRUIT ingress rejects disguised %s origin", kind => {
  const state = recruitmentStart().adventure!;
  const hero = state.party.members[HERO]!;
  const forged = { ...state, partyOrigin: "authored" as const,
    adventureId: kind === "creation-template" ? "adventure.goblin-trouble" : state.adventureId,
    party: { members: { [HERO]: { ...hero,
      actorDefinitionId: kind === "creation-template" ? hero.actorDefinitionId : "hero.aerin",
      identity: { origin: "companion" as const, recruitmentSource: "authored-starter" },
    } } },
  };
  expect(() => assertAdventureCharacterInvariants(forged, context.pack)).toThrow();
});

it("G-RECRUIT seed=65 prior EXP stays with the protagonist; next encounter spawns the companion and pays both", () => {
  const recruited = act(recruitmentReward(), recruitIntent);
  expect(recruited.adventure!.party.members[HERO]!.progression.experience).toBe(200);
  const next = act(recruited, { type: "start-encounter" });
  expect(next.combat!.actors[SECOND]).toMatchObject({ name: "Aerin", definitionId: "hero.aerin", appearanceKey: "hero.aerin" });
  const encounterId = next.adventure!.currentEncounterId!;
  const spawn = context.pack.scenarioSources[encounterId]!.partySpawnSlots.find(slot => slot.seat === 2)!;
  expect(next.combat!.actors[SECOND]!.position).toEqual(spawn.position);
  const victory = dispatchAdventureCommand(next.adventure!, { type: "accept-combat-result", result: {
    encounterId, outcome: "victory", combatSeed: deriveCombatSeed(next.adventureSeed, encounterId), finalCombatHash: "next-victory",
  } }, runtime);
  expect(victory.accepted).toBe(true);
  expect(victory.state.party.members[HERO]!.progression.experience).toBe(450);
  expect(victory.state.party.members[SECOND]!.progression.experience).toBe(250);
});

it.each(["bad-id", "bad-index", "forged-offer", "unwon", "duplicate", "full", "invalid-starter"] as const)("G-RECRUIT seed=65 %s rejects with original party, inventory, reward and growth untouched", kind => {
  const initial = recruitmentReward();
  let state = initial.adventure!;
  let ctx = runtime;
  let intent: typeof recruitIntent | { type: "choose-reward"; rewardId: string; choiceIndex: number } = recruitIntent;
  if (kind === "bad-id") intent = { ...intent, rewardId: "unregistered" };
  if (kind === "bad-index") intent = { ...intent, choiceIndex: 0.5 };
  if (kind === "forged-offer") state = { ...state, pendingReward: { ...state.pendingReward!, choices: [{ kind: "companion", definitionId: "unknown" }] } };
  if (kind === "unwon") state = { ...state, completedEncounterIds: [] };
  if (kind === "duplicate" || kind === "full") {
    const npc = createCompanionMember(context.pack.companions!["companion.aerin"]!, "earlier-reward", 2, context.pack);
    const members: Record<string, typeof npc> = { ...state.party.members, [SECOND]: npc };
    if (kind === "full") {
      members[SECOND] = { ...npc, actorDefinitionId: "hero.lyra" };
      members["party.hero-3"] = { ...npc, id: "party.hero-3", seat: 3, actorDefinitionId: "hero.nera" };
    }
    state = { ...state, party: { members } };
  }
  if (kind === "invalid-starter") ctx = { ...runtime, companions: { "companion.aerin": { ...context.pack.companions!["companion.aerin"]!, startingExperience: -1 } } };
  const original = structuredClone(state);
  const result = dispatchAdventureCommand(state, intent, ctx);
  expect(result.accepted).toBe(false); expect(result.state).toBe(state); expect(result.events).toEqual([]); expect(state).toEqual(original);
});

it("G-SAVE/G-RECRUIT seed=65 round trips pending and recruited checkpoints, preserves current loadout and cannot repay on restore", () => {
  const pending = recruitmentReward();
  const recruited = act(pending, recruitIntent);
  const changed = act(recruited, { type: "set-loadout", memberId: SECOND, loadout: { equipment: {}, preparedCards: [] } });
  for (const checkpoint of [pending, changed]) {
    const record = saveRecord(checkpoint), original = structuredClone(record);
    const projection = restoreCampaignSave(record, context).projection;
    expect(projection.adventure).toEqual(checkpoint.adventure);
    expect(projection.partySlots).toEqual(checkpoint.partySlots);
    expect(record).toEqual(original);
    const fresh = createResumedSessionCoreState({ sessionId: "restored", playerId: "host", displayName: "Host" }, projection, context);
    expect(joinSessionCore(fresh, { playerId: "guest", displayName: "Guest" }, context).accepted).toBe(false);
    const active = act(fresh, { type: "resume-adventure" });
    if (checkpoint === pending) expect(act(active, recruitIntent).adventure).toEqual(recruited.adventure);
    else { expect(recruitmentDispatch(active, recruitIntent).accepted).toBe(false); expect(active.adventure!.party.members[SECOND]!.loadout).toEqual({ equipment: {}, preparedCards: [] }); }
  }
  const old = saveRecord(changed); const payload = JSON.parse(old.snapshotJson); payload.saveSchemaVersion = 4;
  const oldRecord = { ...old, saveSchemaVersion: 4, snapshotJson: JSON.stringify(payload) };
  const preserved = structuredClone(oldRecord);
  expect(() => restoreCampaignSave(oldRecord, context)).toThrow(/not supported/); expect(oldRecord).toEqual(preserved);
});

it("G-RECRUIT seed=65 supports authored non-Human EXP and a second unique recruit in slot 3", () => {
  const original = M7_CONTENT_SOURCE;
  const source = { ...original, companions: [...original.companions!, { id: "companion.lyra", actorDefinitionId: "hero.lyra", description: "Rogue", appearanceKey: "hero.lyra", startingExperience: 375 }],
    adventures: [{ ...runtime.definition, encounterIds: [...runtime.definition.encounterIds, "encounter.ruined-gate"],
      rewards: [...runtime.definition.rewards, { id: "reward.recruit-lyra", afterEncounterId: "encounter.spear-line", choices: [{ kind: "companion" as const, definitionId: "companion.lyra" }] }],
      experienceAwards: [...runtime.definition.experienceAwards, { afterEncounterId: "encounter.ruined-gate", amount: 100 }],
    }] };
  const pack = compileContentPack(source);
  const ctx = { ...pack, definition: pack.adventures[context.adventureId]! };
  const first = act(recruitmentReward(), recruitIntent).adventure!;
  const battle = dispatchAdventureCommand(first, { type: "start-encounter" }, ctx).state;
  const encounterId = battle.currentEncounterId!;
  const won = dispatchAdventureCommand(battle, { type: "accept-combat-result", result: {
    encounterId, outcome: "victory", combatSeed: deriveCombatSeed(battle.adventureSeed, encounterId), finalCombatHash: "second-recruitment",
  } }, ctx).state;
  const result = dispatchAdventureCommand(won, { type: "choose-reward", rewardId: "reward.recruit-lyra", choiceIndex: 0 }, ctx);
  expect(result.accepted).toBe(true);
  expect(result.state.party.members[HERO]).toEqual(won.party.members[HERO]);
  expect(result.state.party.members[SECOND]).toEqual(won.party.members[SECOND]);
  expect(result.state.party.members["party.hero-3"]).toMatchObject({ seat: 3, actorDefinitionId: "hero.lyra", progression: { level: 1, experience: 375, advancements: [] } });
  expect(pack.actorDefinitions["hero.lyra"]!.traits).toContainEqual({ id: "elf" });
  assertAdventureCharacterInvariants(result.state, pack);
});

it.each(["source", "npc", "duplicate", "slot", "origin", "pending", "missing"] as const)("G-SAVE/G-RECRUIT ingress rejects %s provenance without repairing it", kind => {
  const valid = act(recruitmentReward(), recruitIntent);
  const state = structuredClone(valid);
  const member = state.adventure!.party.members[SECOND]!;
  if (kind === "source") Object.assign(member, { identity: { origin: "companion", recruitmentSource: "unknown" } });
  if (kind === "npc") Object.assign(member, { actorDefinitionId: "hero.lyra" });
  if (kind === "duplicate") {
    Object.assign(state.adventure!.party.members, { "party.hero-3": { ...member, id: "party.hero-3", seat: 3 } });
    Object.assign(state, { partySlots: [...state.partySlots, { slot: 3, memberId: "party.hero-3", actorDefinitionId: member.actorDefinitionId }] });
  }
  if (kind === "slot") Object.assign(state, { partySlots: state.partySlots.slice(0, 1) });
  if (kind === "origin") Object.assign(member, { identity: { origin: "companion", recruitmentSource: "authored-starter" } });
  if (kind === "pending") Object.assign(state.adventure!, { phase: "reward", currentEncounterId: "encounter.road-ambush", pendingReward: recruitmentReward().adventure!.pendingReward });
  if (kind === "missing") { Object.assign(state.adventure!, { party: { members: { [HERO]: state.adventure!.party.members[HERO] } } }); Object.assign(state, { partySlots: state.partySlots.slice(0, 1) }); }
  const original = structuredClone(state);
  expect(() => new SessionHost(state, context, "credential-digest")).toThrow();
  expect(() => restoreCampaignSave(saveRecord(state), context)).toThrow(); expect(state).toEqual(original);
});

it("G-RECRUIT content requires authored NPCs, mandatory offers, capacity, complete starter and a later spawn", () => {
  const source = M7_CONTENT_SOURCE;
  const npc = source.companions![0]!;
  for (const actorDefinitionId of ["missing", "goblin.lackey", "character.human-fighter"]) {
    expect(() => compileContentPack({ ...source, companions: [{ ...npc, actorDefinitionId }] })).toThrow();
  }
  expect(() => compileContentPack({ ...source, companions: [npc, npc] })).toThrow();
  expect(() => compileContentPack({ ...source, companions: [{ ...npc, startingExperience: 1000 }] })).toThrow();
  expect(() => compileContentPack({ ...source, actors: source.actors.map(actor => actor.id === npc.actorDefinitionId && isCharacterActorSource(actor)
    ? { ...actor, statProfile: { ...actor.statProfile, level: 3, advancements: [] } } : actor) })).toThrow();
  const tutorial = runtime.definition;
  const reward = tutorial.rewards[0]!;
  for (const bad of [
    { ...tutorial, partySize: { min: 1 as const, max: 1 as const } },
    { ...tutorial, rewards: [{ ...reward, choices: [...reward.choices, { kind: "card" as const, definitionId: "card.trip" }] }] },
    { ...tutorial, rewards: [{ ...reward, afterEncounterId: tutorial.encounterIds.at(-1)! }] },
    { ...tutorial, rewards: [{ ...reward, choices: [{ kind: "companion" as const, definitionId: "missing" }] }] },
  ]) expect(() => compileContentPack({ ...source, adventures: [bad] })).toThrow();
  expect(() => compileContentPack({ ...source, scenarios: source.scenarios.map(scenario => scenario.id === tutorial.encounterIds[1]
    ? { ...scenario, partySpawnSlots: scenario.partySpawnSlots.slice(0, 1) } : scenario) })).toThrow();
  const pending = recruitmentReward();
  assertAdventureCharacterInvariants(pending.adventure!, context.pack);
  expect(createCampaignSave(pending).adventure.pendingReward?.choices[0]?.kind).toBe("companion");
  expect(validateSnapshotState({ v: PROTOCOL_VERSION, revision: pending.revision, state: pending } as ServerSnapshot)).toBe(true);
});
