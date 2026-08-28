import { describe, expect, it } from "vitest";

import { chooseAiCommand } from "./ai";
import { cloneM0Scenario, M0_CONTENT, M0_DEFAULT_SEED } from "./content";
import { createCombat, dispatchCombatCommand } from "./engine";
import { listLegalActions, listLegalTargets, previewAction } from "./queries";
import { hashCombatState, replayCombat } from "./replay";
import { getStatistic } from "./rules";
import type {
  ActionSource,
  ActorSetup,
  CardInstance,
  CombatCommand,
  CombatState,
  ScenarioDefinition,
} from "./types";

function scenarioWith(
  actorOverrides: Readonly<Record<string, Partial<ActorSetup>>> = {},
): ScenarioDefinition {
  const scenario = cloneM0Scenario();
  return {
    ...scenario,
    actors: scenario.actors.map((actor) => ({ ...actor, ...actorOverrides[actor.id] })),
  };
}

function heroFirstScenario(overrides: Readonly<Record<string, Partial<ActorSetup>>> = {}): ScenarioDefinition {
  return scenarioWith({
    hero: { initiativeModifier: 100, ...overrides.hero },
    "goblin-skirmisher": { initiativeModifier: -100, ...overrides["goblin-skirmisher"] },
    "goblin-brute": { initiativeModifier: -100, ...overrides["goblin-brute"] },
  });
}

function command(
  state: CombatState,
  actorId: string,
  source: ActionSource,
  target: Extract<CombatCommand, { type: "use-action" }>["target"],
): CombatCommand {
  return {
    type: "use-action",
    id: `test-${state.sequence + 1}-${source.id}`,
    sequence: state.sequence + 1,
    actorId,
    action: source,
    target,
  };
}

function endTurnCommand(state: CombatState): CombatCommand {
  return {
    type: "end-turn",
    id: `test-${state.sequence + 1}-end`,
    sequence: state.sequence + 1,
    actorId: state.turn.activeActorId,
  };
}

function allCards(state: CombatState, actorId: string): readonly CardInstance[] {
  const zones = state.cardZones[actorId];
  return zones ? [...zones.hand, ...zones.drawPile, ...zones.discardPile] : [];
}

describe("M0 combat core", () => {
  it("builds an equipment-provenance deck and repeats the same initial hash", () => {
    const first = createCombat(cloneM0Scenario(), M0_CONTENT, M0_DEFAULT_SEED).state;
    const second = createCombat(cloneM0Scenario(), M0_CONTENT, M0_DEFAULT_SEED).state;
    expect(hashCombatState(first)).toBe(hashCombatState(second));
    expect(hashCombatState(first)).toBe("068e56657efccd57");
    expect(first.cardZones.hero?.hand).toHaveLength(6);
    expect(first.cardZones.hero?.drawPile).toHaveLength(2);
    const cards = allCards(first, "hero");
    expect(cards.filter((card) => card.definitionId === "card.trip")).toHaveLength(3);
    expect(cards.filter((card) => card.source.objectId === "halberd")).toHaveLength(3);
    expect(cards.filter((card) => card.definitionId === "card.fly")).toHaveLength(2);
    expect(getStatistic(first.actors.hero as NonNullable<typeof first.actors.hero>, M0_CONTENT, "reflex").value).toBe(16);
  });

  it("uses one pipeline for Interact, Raise Shield, and sustained effects", () => {
    let state = createCombat(heroFirstScenario(), M0_CONTENT, 10).state;
    const interact = listLegalActions(state, "hero", M0_CONTENT).find((action) => action.actionId === "interact-lever");
    expect(interact?.enabled).toBe(true);
    const usedLever = dispatchCombatCommand(
      state,
      command(state, "hero", interact?.source as ActionSource, { kind: "object", objectId: "gate-lever" }),
      M0_CONTENT,
    );
    expect(usedLever.accepted).toBe(true);
    state = usedLever.state;
    expect(state.map.tiles["4,3"]?.traits.map((trait) => trait.id)).toContain("open");

    const raise = listLegalActions(state, "hero", M0_CONTENT).find((action) => action.actionId === "raise-shield");
    const raised = dispatchCombatCommand(
      state,
      command(state, "hero", raise?.source as ActionSource, { kind: "none" }),
      M0_CONTENT,
    );
    expect(raised.state.actors.hero?.shieldRaised).toBe(true);
    expect(getStatistic(raised.state.actors.hero as NonNullable<typeof raised.state.actors.hero>, M0_CONTENT, "ac").value).toBe(20);

    const beaconCard = raised.state.cardZones.hero?.hand.find(
      (card) => card.definitionId === "card.spirit-beacon",
    );
    expect(beaconCard).toBeDefined();
    const beacon = dispatchCombatCommand(
      raised.state,
      command(raised.state, "hero", { kind: "card", id: beaconCard?.id as string }, { kind: "none" }),
      M0_CONTENT,
    );
    expect(beacon.accepted).toBe(true);
    expect(Object.values(beacon.state.effects)).toHaveLength(1);
  });

  it("requires explicit facing and applies front/rear combat rules", () => {
    const scenario = heroFirstScenario({
      hero: { position: { x: 1, y: 1 }, facing: "west" },
      "goblin-skirmisher": { position: { x: 2, y: 2 }, hp: 100, maxHp: 100, facing: "east" },
      "goblin-brute": { position: { x: 8, y: 6 } },
    });
    let state = createCombat(scenario, M0_CONTENT, 22).state;
    const strike = { kind: "basic" as const, id: "strike" };
    expect(listLegalTargets(state, "hero", strike, M0_CONTENT)).toEqual([]);

    const step = { kind: "basic" as const, id: "step" };
    const moved = dispatchCombatCommand(
      state,
      command(state, "hero", step, { kind: "tile", position: { x: 1, y: 2 }, facing: "east" }),
      M0_CONTENT,
    );
    expect(moved.accepted).toBe(true);
    state = moved.state;
    expect(state.actors.hero?.facing).toBe("east");

    const preview = previewAction(
      state,
      "hero",
      strike,
      { kind: "actor", actorId: "goblin-skirmisher" },
      M0_CONTENT,
    );
    expect(preview.legal).toBe(true);
    expect(preview.notes).toContain("Rear attack: target AC -2");
  });

  it("counts every Attack trait action for MAP and rejects overspending", () => {
    const scenario = heroFirstScenario({
      hero: { position: { x: 1, y: 1 }, facing: "east" },
      "goblin-skirmisher": { position: { x: 2, y: 1 }, hp: 100, maxHp: 100 },
      "goblin-brute": { position: { x: 8, y: 6 } },
    });
    let state = createCombat(scenario, M0_CONTENT, 33).state;
    const modifiers: number[] = [];
    for (let index = 0; index < 3; index += 1) {
      const result = dispatchCombatCommand(
        state,
        command(state, "hero", { kind: "basic", id: "strike" }, { kind: "actor", actorId: "goblin-skirmisher" }),
        M0_CONTENT,
      );
      expect(result.accepted).toBe(true);
      const check = result.events.find((event) => event.type === "CHECK_ROLLED");
      if (check?.type === "CHECK_ROLLED") modifiers.push(check.modifier);
      state = result.state;
    }
    expect(modifiers).toEqual([8, 3, -2]);
    const fourth = dispatchCombatCommand(
      state,
      command(state, "hero", { kind: "basic", id: "strike" }, { kind: "actor", actorId: "goblin-skirmisher" }),
      M0_CONTENT,
    );
    expect(fourth.accepted).toBe(false);
    expect(fourth.error).toMatch(/actions/i);
  });

  it("charges a two-action activity before rejecting another unaffordable use", () => {
    const scenario = scenarioWith({
      hero: { position: { x: 1, y: 1 }, hp: 100, maxHp: 100, initiativeModifier: -100 },
      "goblin-skirmisher": { position: { x: 8, y: 6 }, initiativeModifier: -101 },
      "goblin-brute": {
        position: { x: 2, y: 1 },
        facing: "west",
        initiativeModifier: 100,
      },
    });
    const initial = createCombat(scenario, M0_CONTENT, 34).state;
    const first = dispatchCombatCommand(
      initial,
      command(
        initial,
        "goblin-brute",
        { kind: "innate", id: "knockdown" },
        { kind: "actor", actorId: "hero" },
      ),
      M0_CONTENT,
    );
    expect(first.accepted).toBe(true);
    expect(first.state.turn.actionsRemaining).toBe(1);
    expect(first.events).toContainEqual({
      type: "ACTION_SPENT",
      actorId: "goblin-brute",
      actionId: "knockdown",
      amount: 2,
      remaining: 1,
    });

    const second = dispatchCombatCommand(
      first.state,
      command(
        first.state,
        "goblin-brute",
        { kind: "innate", id: "knockdown" },
        { kind: "actor", actorId: "hero" },
      ),
      M0_CONTENT,
    );
    expect(second.accepted).toBe(false);
    expect(second.state).toBe(first.state);
    expect(second.error).toMatch(/actions/i);
  });

  it("reshuffles the discard pile deterministically before a turn draw", () => {
    let state = createCombat(cloneM0Scenario(), M0_CONTENT, 35).state;
    const order = state.turn.initiativeOrder;
    const heroIndex = order.indexOf("hero");
    const previousIndex = (heroIndex - 1 + order.length) % order.length;
    const previousActorId = order[previousIndex] as string;
    const cards = allCards(state, "hero");
    state = {
      ...state,
      turn: {
        ...state.turn,
        activeActorId: previousActorId,
        activeIndex: previousIndex,
      },
      cardZones: {
        ...state.cardZones,
        hero: { hand: [], drawPile: [], discardPile: cards },
      },
    };

    const ended = dispatchCombatCommand(state, endTurnCommand(state), M0_CONTENT);
    expect(ended.accepted).toBe(true);
    expect(ended.state.turn.activeActorId).toBe("hero");
    expect(ended.state.cardZones.hero?.hand).toHaveLength(1);
    expect(ended.state.cardZones.hero?.drawPile).toHaveLength(cards.length - 1);
    expect(ended.state.cardZones.hero?.discardPile).toEqual([]);
    expect(ended.events.map((event) => event.type)).toEqual(
      expect.arrayContaining(["DISCARD_RESHUFFLED", "CARD_DRAWN"]),
    );
  });

  it("opens, uses, and resumes a movement reaction exactly once", () => {
    const scenario = scenarioWith({
      hero: { position: { x: 1, y: 1 }, facing: "east", initiativeModifier: -100 },
      "goblin-skirmisher": {
        position: { x: 2, y: 1 },
        facing: "east",
        initiativeModifier: 100,
        hp: 100,
        maxHp: 100,
      },
      "goblin-brute": { position: { x: 8, y: 6 }, initiativeModifier: -101 },
    });
    let state = createCombat(scenario, M0_CONTENT, 44).state;
    const zones = state.cardZones.hero as NonNullable<typeof state.cardZones.hero>;
    const reactive = allCards(state, "hero").find((card) => card.definitionId === "card.reactive-strike");
    expect(reactive).toBeDefined();
    state = {
      ...state,
      cardZones: {
        ...state.cardZones,
        hero: {
          hand: [reactive as CardInstance, ...zones.hand.filter((card) => card.id !== reactive?.id)],
          drawPile: zones.drawPile.filter((card) => card.id !== reactive?.id),
          discardPile: zones.discardPile,
        },
      },
    };

    const movement = dispatchCombatCommand(
      state,
      command(
        state,
        "goblin-skirmisher",
        { kind: "basic", id: "stride" },
        { kind: "tile", position: { x: 3, y: 1 }, facing: "east" },
      ),
      M0_CONTENT,
    );
    expect(movement.accepted).toBe(true);
    expect(movement.state.pendingReaction).not.toBeNull();
    expect(movement.state.actors["goblin-skirmisher"]?.position).toEqual({ x: 2, y: 1 });

    const pending = movement.state.pendingReaction as NonNullable<CombatState["pendingReaction"]>;
    const reaction = dispatchCombatCommand(
      movement.state,
      {
        type: "use-reaction",
        id: "test-reaction",
        sequence: movement.state.sequence + 1,
        actorId: "hero",
        triggerId: pending.triggerId,
        cardInstanceId: reactive?.id as string,
      },
      M0_CONTENT,
    );
    expect(reaction.accepted).toBe(true);
    expect(reaction.state.pendingReaction).toBeNull();
    expect(reaction.state.actors["goblin-skirmisher"]?.position).toEqual({ x: 3, y: 1 });
    expect(reaction.state.actors.hero?.reactionAvailable).toBe(false);
    expect(reaction.events.filter((event) => event.type === "ACTOR_MOVED")).toHaveLength(1);
  });

  it("passes a reaction without consuming its card or resource", () => {
    const scenario = scenarioWith({
      hero: { position: { x: 1, y: 1 }, facing: "east", initiativeModifier: -100 },
      "goblin-skirmisher": {
        position: { x: 2, y: 1 },
        facing: "east",
        initiativeModifier: 100,
        hp: 100,
        maxHp: 100,
      },
      "goblin-brute": { position: { x: 8, y: 6 }, initiativeModifier: -101 },
    });
    let state = createCombat(scenario, M0_CONTENT, 1).state;
    const reactive = state.cardZones.hero?.hand.find((card) => card.definitionId === "card.reactive-strike");
    expect(reactive).toBeDefined();
    const movement = dispatchCombatCommand(
      state,
      command(
        state,
        "goblin-skirmisher",
        { kind: "basic", id: "stride" },
        { kind: "tile", position: { x: 3, y: 1 }, facing: "east" },
      ),
      M0_CONTENT,
    );
    const pending = movement.state.pendingReaction as NonNullable<CombatState["pendingReaction"]>;
    const passed = dispatchCombatCommand(
      movement.state,
      {
        type: "pass-reaction",
        id: "test-pass-reaction",
        sequence: movement.state.sequence + 1,
        actorId: "hero",
        triggerId: pending.triggerId,
      },
      M0_CONTENT,
    );
    state = passed.state;
    expect(passed.accepted).toBe(true);
    expect(state.pendingReaction).toBeNull();
    expect(state.actors["goblin-skirmisher"]?.position).toEqual({ x: 3, y: 1 });
    expect(state.actors.hero?.reactionAvailable).toBe(true);
    expect(state.cardZones.hero?.hand.some((card) => card.id === reactive?.id)).toBe(true);
    expect(passed.events.some((event) => event.type === "REACTION_PASSED")).toBe(true);
  });

  it("queries Stand and Escape variants through the shared Escape context", () => {
    const scenario = heroFirstScenario({
      hero: {
        conditions: [
          { id: "prone", sourceId: "test" },
          { id: "grabbed", sourceId: "test" },
        ],
      },
    });
    let state = createCombat(scenario, M0_CONTENT, 71).state;
    const context = listLegalActions(state, "hero", M0_CONTENT).filter((action) => action.source.kind === "context");
    expect(context.map((action) => action.actionId)).toEqual(
      expect.arrayContaining(["stand", "escape-grab", "interact-lever", "raise-shield"]),
    );
    const stood = dispatchCombatCommand(
      state,
      command(state, "hero", { kind: "context", id: "stand" }, { kind: "none" }),
      M0_CONTENT,
    );
    state = stood.state;
    expect(state.actors.hero?.conditions.map((condition) => condition.id)).toEqual(["grabbed"]);
    expect(stood.events).toContainEqual({ type: "CONDITION_REMOVED", actorId: "hero", condition: "prone" });
  });

  it("replays accepted commands to the same final state and event sequence", () => {
    const scenario = heroFirstScenario();
    const setup = createCombat(scenario, M0_CONTENT, 55);
    let state = setup.state;
    const originalEvents = [...setup.events];
    const commands: CombatCommand[] = [];
    const interactSource = listLegalActions(state, "hero", M0_CONTENT).find(
      (action) => action.actionId === "interact-lever",
    )?.source as ActionSource;
    commands.push(command(state, "hero", interactSource, { kind: "object", objectId: "gate-lever" }));
    const interacted = dispatchCombatCommand(state, commands[0] as CombatCommand, M0_CONTENT);
    state = interacted.state;
    originalEvents.push(...interacted.events);
    commands.push(endTurnCommand(state));
    const ended = dispatchCombatCommand(state, commands[1] as CombatCommand, M0_CONTENT);
    state = ended.state;
    originalEvents.push(...ended.events);

    const replay = replayCombat(scenario, M0_CONTENT, 55, commands);
    expect(hashCombatState(replay.state)).toBe(hashCombatState(state));
    expect(replay.state.commandLog).toEqual(commands);
    expect(replay.events).toEqual(originalEvents);
  });

  it("ends in victory when all enemies are defeated", () => {
    const scenario = heroFirstScenario({
      hero: { position: { x: 1, y: 1 }, facing: "east" },
      "goblin-skirmisher": { position: { x: 2, y: 1 }, hp: 1, maxHp: 1, baseAc: -100 },
      "goblin-brute": { position: { x: 1, y: 2 }, hp: 1, maxHp: 1, baseAc: -100 },
    });
    let state = createCombat(scenario, M0_CONTENT, 77).state;
    for (const targetActorId of ["goblin-skirmisher", "goblin-brute"]) {
      const result = dispatchCombatCommand(
        state,
        command(state, "hero", { kind: "basic", id: "strike" }, { kind: "actor", actorId: targetActorId }),
        M0_CONTENT,
      );
      expect(result.accepted).toBe(true);
      state = result.state;
    }
    expect(state.outcome).toBe("victory");
  });

  it("provides deterministic enemy commands and can reach a terminal battle state", () => {
    const scenario = scenarioWith({
      hero: { hp: 1, maxHp: 1, position: { x: 5, y: 2 }, initiativeModifier: -100 },
      "goblin-skirmisher": { position: { x: 6, y: 2 }, facing: "west", initiativeModifier: 100 },
      "goblin-brute": { position: { x: 8, y: 6 }, initiativeModifier: -101 },
    });
    let state = createCombat(scenario, M0_CONTENT, 66).state;
    for (let index = 0; index < 30 && !state.outcome; index += 1) {
      const active = state.actors[state.turn.activeActorId];
      const nextCommand: CombatCommand | null = state.pendingReaction
        ? {
            type: "pass-reaction",
            id: `test-${state.sequence + 1}-pass`,
            sequence: state.sequence + 1,
            actorId: state.pendingReaction.candidates[0]?.actorId as string,
            triggerId: state.pendingReaction.triggerId,
          }
        : active?.team === "heroes"
          ? endTurnCommand(state)
          : chooseAiCommand(state, M0_CONTENT);
      expect(nextCommand).not.toBeNull();
      const result = dispatchCombatCommand(state, nextCommand as CombatCommand, M0_CONTENT);
      expect(result.accepted).toBe(true);
      state = result.state;
    }
    expect(state.outcome).toBe("defeat");
  });
});
