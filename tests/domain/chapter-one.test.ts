import { expect, it } from "vitest";
import { buildAdventureEncounter } from "../../src/adventure";
import { createCombat, dispatchCombatCommand } from "../../src/game";
import { movementCost } from "../../src/game/grid";
import { validateContentPackSemantics } from "../../src/content/validate-semantics";
import { M7_CONTENT_SOURCE } from "../../src/content/load-m7-content";
import { deriveTacticalDeck } from "../../src/loadout";
import { resolvePartyMemberDefinition } from "../../src/character/member";
import { dispatchSessionIntent } from "../../src/session";
import { chapterAt, chapterReady, chapterReward, chapterComplete } from "../support/chapter-one";
import { tutorialAct as act, tutorialContext as context } from "../support/tutorial";
import { HERO } from "../support/session";
import { command } from "../support/combat";

it("G-CHAPTER four field maps retain terrain, level-1 foes and reachable mandatory targets", () => {
  expect(context.pack.adventures[context.adventureId]!.encounterIds).toHaveLength(8);
  for (let index = 0; index < 4; index++) {
    const state = act(chapterAt(index), { type: "start-encounter" }).combat!;
    expect(state.partyHpFloor).toBeUndefined(); expect(state.map.width).toBeGreaterThanOrEqual(20); expect(state.map.height).toBeGreaterThanOrEqual(20);
    const tiles = Object.values(state.map.tiles);
    for (const id of ["forest-grass", "forest-dirt", "forest-leaves", "pond-water"]) expect(tiles.some(t => t.traits.some(x => x.id === id))).toBe(true);
    for (const tile of tiles.filter(t => t.traits.some(x => x.id === "pond-water"))) expect(movementCost(tile, "land")).toBeNull();
    // Destroyable barriers can open routes; buildings and water remain permanent barriers.
    const destroyed = new Set(Object.values(state.map.objects).map(o => `${o.position.x},${o.position.y}`));
    const reached = new Set<string>(); const queue = [state.actors[HERO]!.position];
    while (queue.length) {
      const p = queue.shift()!; const key = `${p.x},${p.y}`; const tile = state.map.tiles[key];
      if (!tile || reached.has(key) || (!destroyed.has(key) && movementCost(tile, "land") === null)) continue;
      reached.add(key); queue.push({ x: p.x + 1, y: p.y }, { x: p.x - 1, y: p.y }, { x: p.x, y: p.y + 1 }, { x: p.x, y: p.y - 1 });
    }
    for (const actor of Object.values(state.actors)) expect(reached.has(`${actor.position.x},${actor.position.y}`), `${state.scenarioId}/${actor.id}`).toBe(true);
    for (const id of state.rules?.victory?.objectIds ?? []) { const p = state.map.objects[id]!.position; expect(reached.has(`${p.x},${p.y}`)).toBe(true); }
  }
});

it.each([1, 2, 3])("G-CHAPTER objective %i requires every target and ends with surviving guards", index => {
  const session = act(chapterAt(index), { type: "start-encounter" });
  const definition = buildAdventureEncounter(context.pack, session.adventure!).definition;
  const initial = createCombat({ ...definition, scenario: { ...definition.scenario,
    actors: definition.scenario.actors.map(actor => actor.id === HERO ? { ...actor, statProfile: { kind: "creature" as const, stats: { ac: 20, maxHp: 30, perception: 100, saves: { fortitude: 5, reflex: 5, will: 5 }, skills: {}, strike: { name: "Test", attackModifier: 10, rangeFeet: 5, damage: { count: 1, sides: 4, modifier: 0, damageType: "slashing" as const }, traits: [] } } } } : actor) } }, 60).state;
  const goal = initial.rules!.victory!;
  const resolved = { ...initial,
    actors: Object.fromEntries(Object.entries(initial.actors).map(([id,a]) => [id, goal.enemyIds.includes(id) ? { ...a, hp: 0, defeated: true } : a])),
    map: { ...initial.map, objects: Object.fromEntries(Object.entries(initial.map.objects).map(([id,o]) => [id, goal.objectIds.includes(id) ? { ...o, used: true } : o])) } };
  const lastEnemy = goal.enemyIds.at(-1); const lastObject = goal.objectIds.at(-1);
  const incomplete = { ...resolved, ...(lastEnemy ? { actors: { ...resolved.actors, [lastEnemy]: initial.actors[lastEnemy]! } } : {}),
    ...(lastObject ? { map: { ...resolved.map, objects: { ...resolved.map.objects, [lastObject]: initial.map.objects[lastObject]! } } } : {}) };
  const input = { type: "use-action", actorId: HERO, action: { kind: "basic", id: "step" }, target: { kind: "tile", position: initial.actors[HERO]!.position, facing: "north" } } as const;
  const partial = dispatchCombatCommand(incomplete, command(incomplete,input), definition.content);
  expect(partial.accepted, partial.error).toBe(true); expect(partial.state.outcome).toBeNull();
  const complete = dispatchCombatCommand(resolved, command(resolved,input), definition.content);
  expect(complete.accepted, complete.error).toBe(true); expect(complete.state.outcome).toBe("victory");
  expect(Object.values(complete.state.actors).some(a => a.team === "enemies" && !a.defeated)).toBe(true);
});

it("G-CHAPTER target authoring rejects empty, missing and party-size-dependent goals", () => {
  for (const victory of [{ enemyIds: [], objectIds: [] }, { enemyIds: ["missing"], objectIds: [] }, { enemyIds: ["willow-dike-rogue-2"], objectIds: [] }, { enemyIds: [], objectIds: ["missing"] }]) {
    const source = { ...M7_CONTENT_SOURCE, scenarios: M7_CONTENT_SOURCE.scenarios.map(s => s.id === "encounter.willow-dike" ? { ...s, rules: { victory } } : s) };
    expect(validateContentPackSemantics(source).some(issue => issue.code === "INVALID_VICTORY_TARGET")).toBe(true);
  }
});

it("G-CHAPTER all four rewards are single grants; completion allows owned deck edits but no combat restart", () => {
  let state = chapterReady();
  const expected = ["sickle", "card.needle-darts", "dueling-cape", "card.shield-spell"];
  for (const id of expected) {
    const reward = chapterReward(state); const request = { type: "choose-reward", rewardId: reward.adventure!.pendingReward!.rewardId, choiceIndex: 0 } as const;
    state = act(reward, request);
    const held = id.startsWith("card.") ? state.adventure!.collection.cards : state.adventure!.collection.equipment;
    expect(held[id]).toBe(1); expect(() => act(state,request)).toThrow();
  }
  expect(state.adventure!.phase).toBe("complete"); expect(state.adventure!.completedEncounterIds).toHaveLength(8);
  expect(Object.values(state.adventure!.party.members).every(m => m.progression.level === 1)).toBe(true);
  expect(() => act(state, { type: "start-encounter" })).toThrow();
  const member = state.adventure!.party.members[HERO]!;
  const loadout = { ...member.loadout, equipment: { ...member.loadout.equipment, weapon: "sickle", shield: "dueling-cape" }, preparedCards: ["card.needle-darts", "card.shield-spell"] };
  state = act(state, { type: "set-loadout", memberId: HERO, loadout });
  const prepared = state.adventure!.party.members[HERO]!;
  expect(deriveTacticalDeck(resolvePartyMemberDefinition(prepared,context.pack),prepared.loadout,context.pack.combatContent,HERO).contributions.map(c => c.cardDefinitionId)).toEqual(expect.arrayContaining(["card.trip","card.needle-darts","card.shield-spell"]));
  expect(() => act(state, { type: "set-loadout", memberId: HERO, loadout: { ...loadout, preparedCards: ["card.shield-spell", "card.shield-spell"] } })).toThrow();
  const foreign = dispatchSessionIntent(state,"guest",{ type: "set-loadout",memberId:HERO,loadout },context,{ connectedPlayerIds:["host","guest"], effectiveControllerByMemberId:{[HERO]:"host"} });
  expect(foreign.accepted).toBe(false);
  expect(chapterComplete().adventure!.phase).toBe("complete");
});

it("G-CHAPTER gate victory fires on the second real destruction and restores through replay", async () => {
  const { play } = await import("../support/combat");
  const { createCombatReplay,replayCombat } = await import("../../src/game");
  const session = act(chapterAt(2),{type:"start-encounter"});
  const source = buildAdventureEncounter(context.pack,session.adventure!).definition;
  const definition = {...source,scenario:{...source.scenario,actors:source.scenario.actors.map(a=>a.team==="heroes"?{...a,position:{x:a.id===HERO?8:11,y:9},statProfile:{kind:"creature" as const,stats:{ac:20,maxHp:30,perception:a.id===HERO?100:90,saves:{fortitude:5,reflex:5,will:5},skills:{},strike:{name:"Test",attackModifier:10,rangeFeet:5,damage:{count:1,sides:4,modifier:0,damageType:"slashing" as const},traits:[]}}}}:a)}};
  let state=createCombat(definition,60).state;
  state=play(state,{type:"use-action",actorId:HERO,action:{kind:"context",id:"destroy-obstacle"},target:{kind:"object",objectId:"willow-gate-tree-8-8"}},definition);
  expect(state.outcome).toBeNull();
  state=play(state,{type:"end-turn",actorId:HERO,facing:"north"},definition);
  expect(state.turn.activeActorId).toBe("party.hero-2");
  state=play(state,{type:"use-action",actorId:"party.hero-2",action:{kind:"context",id:"destroy-obstacle"},target:{kind:"object",objectId:"willow-gate-rock-11-8"}},definition);
  expect(state.outcome).toBe("victory");expect(state.turn.actionsRemaining).toBe(2);
  expect(replayCombat(definition,createCombatReplay(state)).state).toEqual(state);
});

it("G-CHAPTER Shield costs one action, grants nonstacking AC +1 and expires next turn", async () => {
  const { laneCombat,play } = await import("../support/combat");
  const { resolveArmorClass } = await import("../../src/game/statistics");
  const lane = laneCombat();
  const definition = { ...lane,content:context.pack.combatContent,scenario:{...lane.scenario,actors:lane.scenario.actors.map(a=>({...a,
    equipmentIds:a.team==="heroes"?["dueling-cape"]:[],
    deckContributions:a.team==="heroes"?[{cardDefinitionId:"card.shield-spell",count:1,source:{kind:"base" as const,sourceId:a.id}}]:[]}))}};
  let state=createCombat(definition,60).state;
  const card=state.cardZones.hero!.hand[0]!;
  const ac=resolveArmorClass(state.actors.hero!,{content:definition.content}).value;
  state=play(state,{type:"use-action",actorId:"hero",action:{kind:"card",id:card.id},target:{kind:"none"}},definition);
  expect(state.turn.actionsRemaining).toBe(2);expect(resolveArmorClass(state.actors.hero!,{content:definition.content}).value).toBe(ac+1);
  state=play(state,{type:"use-action",actorId:"hero",action:{kind:"context",id:"raise-shield"},target:{kind:"none"}},definition);
  expect(resolveArmorClass(state.actors.hero!,{content:definition.content}).value).toBe(ac+1);
  state=play(state,{type:"end-turn",actorId:"hero",facing:"east"},definition);
  state=play(state,{type:"end-turn",actorId:"enemy",facing:"west"},definition);
  expect(state.actors.hero!.conditions.some(c=>c.id==="warded")).toBe(false);
  expect(resolveArmorClass(state.actors.hero!,{content:definition.content}).value).toBe(ac);
});
