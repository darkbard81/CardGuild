import { describe, expect, it } from "vitest";
import {
  createCombatReplay, dispatchCombatCommand, findPath, listLegalTargets, replayCombat,
  type CombatState,
} from "../../src/game";
import { battle, command, laneCombat, play } from "../support/combat";

const stride = { kind: "basic", id: "stride" } as const;
const tile = (x: number) => ({ kind: "tile" as const, position: { x, y: 0 } });
const resources = (state: CombatState) => ({
  actors: Object.values(state.actors).map(({ id, hp, position, reactionAvailable }) => ({ id, hp, position, reactionAvailable })),
  actions: state.turn.actionsRemaining, cards: state.cardZones, rng: state.rng, sequence: state.sequence,
});

describe("G-MOVE movement promises", () => {
  it("passes through an ally but cannot stop on either an ally or an enemy", () => {
    const definition = laneCombat({ ally: true });
    const state = battle(definition);
    const targets = listLegalTargets(state, "hero", stride, definition.content);
    expect(targets).toContainEqual(expect.objectContaining({ kind: "tile", position: { x: 2, y: 0 } }));
    for (const x of [1, 3]) {
      expect(targets).not.toContainEqual(expect.objectContaining({ kind: "tile", position: { x, y: 0 } }));
      expect(dispatchCombatCommand(state, command(state, { type: "use-action", actorId: "hero", action: stride, target: tile(x) }), definition.content).accepted).toBe(false);
    }
    const next = play(state, { type: "use-action", actorId: "hero", action: stride, target: tile(2) }, definition);
    expect(next.actors.hero?.position).toEqual({ x: 2, y: 0 });
    expect(next.turn.actionsRemaining).toBe(2);
  });

  it.each([
    ["difficult", "land", 14, false], ["difficult", "land", 15, true],
    ["impassable", "land", 15, false], ["impassable", "fly", 10, true],
    ["blocked", "fly", 15, false],
  ] as const)("respects %s terrain for %s at %i feet", (terrain, mode, feet, reachable) => {
    const state = battle(laneCombat({ ally: true, terrain: { 1: [{ id: terrain }] } }));
    expect(Boolean(findPath(state.map, state.actors, "hero", { x: 0, y: 0 }, { x: 2, y: 0 }, feet, mode))).toBe(reachable);
  });
});

describe("G-COMBAT accepted and refused input", () => {
  it("a refused distant attack and replayed command preserve HP, position, cards, actions and RNG", () => {
    const definition = laneCombat();
    const state = battle(definition);
    const invalid = command(state, { type: "use-action", actorId: "hero", action: { kind: "basic", id: "strike" }, target: { kind: "actor", actorId: "enemy" } });
    const rejected = dispatchCombatCommand(state, invalid, definition.content);
    expect(rejected.accepted).toBe(false);
    expect(resources(rejected.state)).toEqual(resources(state));
    const move = command(state, { type: "use-action", actorId: "hero", action: stride, target: tile(2) });
    const moved = dispatchCombatCommand(state, move, definition.content);
    expect(moved.accepted).toBe(true);
    const duplicate = dispatchCombatCommand(moved.state, move, definition.content);
    expect(duplicate.accepted).toBe(false);
    expect(resources(duplicate.state)).toEqual(resources(moved.state));
  });

  it("playing a card spends it and its action once; it cannot be played again from discard", () => {
    const definition = laneCombat();
    let state = play(battle(definition), { type: "use-action", actorId: "hero", action: stride, target: tile(2) }, definition);
    const card = state.cardZones.hero!.hand[0]!;
    const attack = { type: "use-action", actorId: "hero", action: { kind: "card", id: card.id }, target: { kind: "actor", actorId: "enemy" } } as const;
    state = play(state, attack, definition);
    expect(state.turn.actionsRemaining).toBe(1);
    expect(state.turn.attacksThisTurn).toBe(1);
    expect(state.cardZones.hero!.hand).toHaveLength(0);
    expect(state.cardZones.hero!.discardPile.map(c => c.id)).toEqual([card.id]);
    const second = dispatchCombatCommand(state, command(state, attack), definition.content);
    expect(second.accepted).toBe(false);
    expect(resources(second.state)).toEqual(resources(state));
  });

  it.each(["use-reaction", "pass-reaction"] as const)("%s resolves the pending move exactly once", type => {
    const definition = laneCombat({ reaction: true });
    let state = play(battle(definition), { type: "use-action", actorId: "hero", action: stride, target: tile(2) }, definition);
    state = play(state, { type: "end-turn", actorId: "hero", facing: "east" }, definition);
    state = play(state, { type: "use-action", actorId: "enemy", action: stride, target: tile(4) }, definition);
    expect(state.pendingReaction).not.toBeNull();
    const pending = state.pendingReaction!;
    const candidate = pending.candidates[0]!;
    const input = type === "use-reaction"
      ? { type, actorId: candidate.actorId, triggerId: pending.triggerId, cardInstanceId: candidate.cardInstanceId }
      : { type, actorId: candidate.actorId, triggerId: pending.triggerId };
    const resolved = play(state, input, definition);
    expect(resolved.pendingReaction).toBeNull();
    expect(resolved.actors.enemy!.position).toEqual({ x: 4, y: 0 });
    expect(resolved.turn.actionsRemaining).toBe(2);
    expect(resolved.actors.hero!.reactionAvailable).toBe(type === "pass-reaction");
    expect(resolved.cardZones.hero!.discardPile.some(card => card.id === candidate.cardInstanceId)).toBe(type === "use-reaction");
    const repeated = dispatchCombatCommand(resolved, command(resolved, input), definition.content);
    expect(repeated.accepted).toBe(false);
    expect(resources(repeated.state)).toEqual(resources(resolved));
  });
});

it("G-REPLAY the same seed and legal command history reproduce gameplay", () => {
  const definition = laneCombat();
  let state = play(battle(definition), { type: "use-action", actorId: "hero", action: stride, target: tile(2) }, definition);
  state = play(state, { type: "use-action", actorId: "hero", action: { kind: "basic", id: "strike" }, target: { kind: "actor", actorId: "enemy" } }, definition);
  state = play(state, { type: "end-turn", actorId: "hero", facing: "north" }, definition);
  const replayed = replayCombat(definition, createCombatReplay(state)).state;
  expect(resources(replayed)).toEqual(resources(state));
  expect(replayed.turn).toEqual(state.turn);
  expect(replayed.outcome).toBe(state.outcome);
  expect(() => replayCombat({ ...definition, contentIdentity: { ...definition.contentIdentity, fingerprint: "other" } }, createCombatReplay(state))).toThrow(/content mismatch/);
});
