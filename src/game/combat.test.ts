import { describe, expect, it } from "vitest";

import {
  cloneM0Scenario,
  M0_CONTENT,
  M0_CONTENT_IDENTITY,
  M0_DEFAULT_SEED,
} from "../content/load-m0-content";
import { chooseAiCommand } from "./ai";
import { createCombat, dispatchCombatCommand } from "./engine";
import {
  listLegalActions,
  listLegalTargets,
  previewAction,
  validateActionIntent,
} from "./queries";
import { createCombatReplay, hashCombatState, replayCombat } from "./replay";
import { getStatistic } from "./rules";
import type {
  ActionSource,
  ActionDefinition,
  ActorSetup,
  CardInstance,
  CombatCommand,
  CombatContent,
  CombatSetupResult,
  CombatState,
  ScenarioDefinition,
} from "./types";

function createM0Combat(
  scenario: ScenarioDefinition,
  seed: number,
  content: CombatContent = M0_CONTENT,
): CombatSetupResult {
  return createCombat({ scenario, content, contentIdentity: M0_CONTENT_IDENTITY }, seed);
}

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
    const first = createM0Combat(cloneM0Scenario(), M0_DEFAULT_SEED).state;
    const second = createM0Combat(cloneM0Scenario(), M0_DEFAULT_SEED).state;
    expect(hashCombatState(first)).toBe(hashCombatState(second));
    expect(hashCombatState(first)).toBe("5fa9d0a7d69322a5");
    expect(
      Object.values(first.actors).every(
        (actor) => actor.reactionAvailable === (actor.id === first.turn.activeActorId),
      ),
    ).toBe(true);
    expect(first.cardZones.hero?.hand).toHaveLength(6);
    expect(first.cardZones.hero?.drawPile).toHaveLength(2);
    const cards = allCards(first, "hero");
    expect(cards.filter((card) => card.definitionId === "card.trip")).toHaveLength(3);
    expect(cards.filter((card) => card.source.objectId === "halberd")).toHaveLength(3);
    expect(cards.filter((card) => card.definitionId === "card.fly")).toHaveLength(2);
    expect(getStatistic(first.actors.hero as NonNullable<typeof first.actors.hero>, M0_CONTENT, "reflex").value).toBe(16);
  });

  it("uses one pipeline for Interact, Raise Shield, and sustained effects", () => {
    let state = createM0Combat(heroFirstScenario(), 10).state;
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
    let state = createM0Combat(scenario, 22).state;
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
    let state = createM0Combat(scenario, 33).state;
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
    const initial = createM0Combat(scenario, 34).state;
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
    let state = createM0Combat(cloneM0Scenario(), 35).state;
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

  it("increments rounds only on initiative wrap and refreshes reactions at the actor turn start", () => {
    const initial = createM0Combat(heroFirstScenario(), 36).state;
    const order = initial.turn.initiativeOrder;
    const skippedActorId = order[1] as string;
    const nextActorId = order[2] as string;
    const skippedActor = initial.actors[skippedActorId] as NonNullable<typeof initial.actors.hero>;
    const hero = initial.actors.hero as NonNullable<typeof initial.actors.hero>;
    let state: CombatState = {
      ...initial,
      actors: {
        ...initial.actors,
        hero: { ...hero, reactionAvailable: false },
        [skippedActorId]: { ...skippedActor, defeated: true, hp: 0 },
      },
    };

    state = dispatchCombatCommand(state, endTurnCommand(state), M0_CONTENT).state;
    expect(state.round).toBe(1);
    expect(state.turn.activeActorId).toBe(nextActorId);
    expect(state.turn.initiativeOrder).toEqual(order);
    expect(state.actors.hero?.reactionAvailable).toBe(false);

    state = dispatchCombatCommand(state, endTurnCommand(state), M0_CONTENT).state;
    expect(state.round).toBe(2);
    expect(state.turn.activeActorId).toBe("hero");
    expect(state.turn.initiativeOrder).toEqual(order);
    expect(state.actors.hero?.reactionAvailable).toBe(true);
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
    let state = createM0Combat(scenario, 44).state;
    const zones = state.cardZones.hero as NonNullable<typeof state.cardZones.hero>;
    const reactive = allCards(state, "hero").find((card) => card.definitionId === "card.reactive-strike");
    expect(reactive).toBeDefined();
    state = {
      ...state,
      actors: {
        ...state.actors,
        hero: { ...(state.actors.hero as NonNullable<typeof state.actors.hero>), reactionAvailable: true },
      },
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

    const secondUse = dispatchCombatCommand(
      reaction.state,
      {
        type: "use-reaction",
        id: "test-reaction-again",
        sequence: reaction.state.sequence + 1,
        actorId: "hero",
        triggerId: pending.triggerId,
        cardInstanceId: reactive?.id as string,
      },
      M0_CONTENT,
    );
    expect(secondUse.accepted).toBe(false);
    expect(secondUse.error).toMatch(/unavailable/i);
  });

  it("opens a movement reaction for Stride but never for Step", () => {
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
    let initial = createM0Combat(scenario, 1).state;
    const zones = initial.cardZones.hero as NonNullable<typeof initial.cardZones.hero>;
    const reactive = allCards(initial, "hero").find(
      (card) => card.definitionId === "card.reactive-strike",
    ) as CardInstance;
    initial = {
      ...initial,
      actors: {
        ...initial.actors,
        hero: { ...(initial.actors.hero as NonNullable<typeof initial.actors.hero>), reactionAvailable: true },
      },
      cardZones: {
        ...initial.cardZones,
        hero: {
          hand: [reactive, ...zones.hand.filter((card) => card.id !== reactive.id)],
          drawPile: zones.drawPile.filter((card) => card.id !== reactive.id),
          discardPile: zones.discardPile,
        },
      },
    };

    const stride = dispatchCombatCommand(
      initial,
      command(
        initial,
        "goblin-skirmisher",
        { kind: "basic", id: "stride" },
        { kind: "tile", position: { x: 3, y: 1 }, facing: "east" },
      ),
      M0_CONTENT,
    );
    expect(stride.state.pendingReaction).not.toBeNull();
    expect(stride.events.some((event) => event.type === "REACTION_OPENED")).toBe(true);

    const step = dispatchCombatCommand(
      initial,
      command(
        initial,
        "goblin-skirmisher",
        { kind: "basic", id: "step" },
        { kind: "tile", position: { x: 3, y: 1 }, facing: "east" },
      ),
      M0_CONTENT,
    );
    expect(step.accepted).toBe(true);
    expect(step.state.pendingReaction).toBeNull();
    expect(step.state.actors["goblin-skirmisher"]?.position).toEqual({ x: 3, y: 1 });
    expect(step.events.some((event) => event.type === "REACTION_OPENED")).toBe(false);
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
    let state = createM0Combat(scenario, 1).state;
    state = {
      ...state,
      actors: {
        ...state.actors,
        hero: { ...(state.actors.hero as NonNullable<typeof state.actors.hero>), reactionAvailable: true },
      },
    };
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
    let state = createM0Combat(scenario, 71).state;
    const context = listLegalActions(state, "hero", M0_CONTENT).filter((action) => action.source.kind === "context");
    expect(context.map((action) => action.actionId)).toEqual(
      expect.arrayContaining(["stand", "escape-grab", "interact-lever", "raise-shield"]),
    );
    expect(
      context
        .filter((action) => action.actionId === "stand" || action.actionId === "escape-grab")
        .every((action) => action.contextGroup === "escape"),
    ).toBe(true);
    const stood = dispatchCombatCommand(
      state,
      command(state, "hero", { kind: "context", id: "stand" }, { kind: "none" }),
      M0_CONTENT,
    );
    state = stood.state;
    expect(state.actors.hero?.conditions.map((condition) => condition.id)).toEqual(["grabbed"]);
    expect(stood.events).toContainEqual({ type: "CONDITION_REMOVED", actorId: "hero", condition: "prone" });
  });

  it("derives cards and context recovery actions from trait providers", () => {
    const recoverTest: ActionDefinition = {
      id: "recover-test",
      name: "Recover Test",
      description: "Provider regression action.",
      timing: { kind: "turn", actions: 1 },
      traits: [{ id: "move" }],
      targeting: "self",
      effect: { kind: "remove-condition", condition: "test-condition" },
    };
    const providerContent: CombatContent = {
      ...M0_CONTENT,
      actions: { ...M0_CONTENT.actions, [recoverTest.id]: recoverTest },
      equipment: {
        ...M0_CONTENT.equipment,
        "trait-only-kit": {
          id: "trait-only-kit",
          name: "Trait-only Kit",
          traits: [{ id: "trip" }, { id: "fly" }, { id: "shield" }],
          statModifiers: [],
        },
      },
      traits: {
        ...M0_CONTENT.traits,
        "test-recovery": {
          id: "test-recovery",
          name: "Test Recovery",
          cardGrants: [],
          actionGrants: [{ actionId: recoverTest.id, contextGroup: "escape" }],
        },
      },
      conditions: {
        ...M0_CONTENT.conditions,
        "test-condition": {
          id: "test-condition",
          name: "Test Condition",
          traits: [{ id: "condition" }, { id: "test-recovery" }],
        },
      },
    };
    const scenario = heroFirstScenario({
      hero: {
        equipmentIds: ["trait-only-kit"],
        conditions: [{ id: "test-condition", sourceId: "test" }],
      },
    });
    const state = createM0Combat(scenario, 72, providerContent).state;
    const cards = allCards(state, "hero");
    expect(cards.filter((card) => card.definitionId === "card.trip")).toHaveLength(3);
    expect(cards.filter((card) => card.definitionId === "card.fly")).toHaveLength(2);
    expect(
      cards
        .filter((card) => card.definitionId === "card.trip" || card.definitionId === "card.fly")
        .every((card) => card.source.objectId === "trait-only-kit"),
    ).toBe(true);
    const actions = listLegalActions(state, "hero", providerContent);
    expect(actions.find((action) => action.actionId === "raise-shield")?.enabled).toBe(true);
    expect(actions.find((action) => action.actionId === recoverTest.id)?.contextGroup).toBe("escape");
  });

  it("shares action legality across preview, query, and dispatch", () => {
    const scenario = heroFirstScenario({
      hero: { position: { x: 1, y: 1 }, facing: "east" },
      "goblin-skirmisher": { position: { x: 2, y: 1 }, hp: 100, maxHp: 100 },
      "goblin-brute": { position: { x: 8, y: 6 } },
    });
    const source = { kind: "basic" as const, id: "strike" };
    const target = { kind: "actor" as const, actorId: "goblin-skirmisher" };
    const initial = createM0Combat(scenario, 73).state;
    const cases: readonly CombatState[] = [
      { ...initial, turn: { ...initial.turn, actionsRemaining: 0 } },
      {
        ...initial,
        turn: {
          ...initial.turn,
          activeActorId: "goblin-skirmisher",
          activeIndex: initial.turn.initiativeOrder.indexOf("goblin-skirmisher"),
        },
      },
    ];

    for (const state of cases) {
      const validation = validateActionIntent(state, "hero", source, target, M0_CONTENT);
      const preview = previewAction(state, "hero", source, target, M0_CONTENT);
      const dispatched = dispatchCombatCommand(
        state,
        command(state, "hero", source, target),
        M0_CONTENT,
      );
      expect(validation.legal).toBe(false);
      expect(preview.legal).toBe(validation.legal);
      expect(preview.reason).toBe(validation.reason);
      expect(dispatched.accepted).toBe(validation.legal);
      expect(dispatched.error).toBe(validation.reason);
      expect(listLegalTargets(state, "hero", source, M0_CONTENT)).toEqual([]);
    }

    const reactionScenario = scenarioWith({
      hero: { position: { x: 1, y: 1 }, facing: "east", initiativeModifier: -100 },
      "goblin-skirmisher": {
        position: { x: 2, y: 1 },
        facing: "east",
        initiativeModifier: 100,
      },
      "goblin-brute": { position: { x: 8, y: 6 }, initiativeModifier: -101 },
    });
    const reactionSetup = createM0Combat(reactionScenario, 1).state;
    const beforeReaction: CombatState = {
      ...reactionSetup,
      actors: {
        ...reactionSetup.actors,
        hero: {
          ...(reactionSetup.actors.hero as NonNullable<typeof reactionSetup.actors.hero>),
          reactionAvailable: true,
        },
      },
    };
    const opened = dispatchCombatCommand(
      beforeReaction,
      command(
        beforeReaction,
        "goblin-skirmisher",
        { kind: "basic", id: "stride" },
        { kind: "tile", position: { x: 3, y: 1 }, facing: "east" },
      ),
      M0_CONTENT,
    );
    expect(opened.state.pendingReaction).not.toBeNull();
    const pendingSource = { kind: "basic" as const, id: "strike" };
    const pendingTarget = { kind: "actor" as const, actorId: "hero" };
    const pendingValidation = validateActionIntent(
      opened.state,
      "goblin-skirmisher",
      pendingSource,
      pendingTarget,
      M0_CONTENT,
    );
    const pendingPreview = previewAction(
      opened.state,
      "goblin-skirmisher",
      pendingSource,
      pendingTarget,
      M0_CONTENT,
    );
    const pendingDispatch = dispatchCombatCommand(
      opened.state,
      command(opened.state, "goblin-skirmisher", pendingSource, pendingTarget),
      M0_CONTENT,
    );
    expect(pendingValidation.reason).toMatch(/reaction/i);
    expect(pendingPreview.reason).toBe(pendingValidation.reason);
    expect(pendingDispatch.error).toBe(pendingValidation.reason);
  });

  it("locks Escape after critical failure until the actor's next turn", () => {
    const scenario = heroFirstScenario({
      hero: { conditions: [{ id: "grabbed", sourceId: "test" }] },
    });
    const state = createM0Combat(scenario, 66).state;
    const source = { kind: "context" as const, id: "escape-grab" };
    const escaped = dispatchCombatCommand(
      state,
      command(state, "hero", source, { kind: "none" }),
      M0_CONTENT,
    );
    expect(escaped.accepted).toBe(true);
    expect(escaped.events).toContainEqual(
      expect.objectContaining({ type: "CHECK_ROLLED", degree: "critical-failure" }),
    );
    expect(escaped.state.actors.hero?.conditions.some((condition) => condition.id === "grabbed")).toBe(true);
    expect(escaped.state.turn.lockedActionIds).toContain("escape-grab");
    expect(escaped.events).toContainEqual({
      type: "ACTION_LOCKED",
      actorId: "hero",
      actionId: "escape-grab",
    });

    const preview = previewAction(
      escaped.state,
      "hero",
      source,
      { kind: "none" },
      M0_CONTENT,
    );
    const retry = dispatchCombatCommand(
      escaped.state,
      command(escaped.state, "hero", source, { kind: "none" }),
      M0_CONTENT,
    );
    expect(preview.legal).toBe(false);
    expect(retry.accepted).toBe(false);
    expect(retry.error).toBe(preview.reason);

    let nextTurn = dispatchCombatCommand(escaped.state, endTurnCommand(escaped.state), M0_CONTENT).state;
    while (nextTurn.turn.activeActorId !== "hero") {
      nextTurn = dispatchCombatCommand(nextTurn, endTurnCommand(nextTurn), M0_CONTENT).state;
    }
    expect(nextTurn.turn.lockedActionIds).toEqual([]);
    expect(
      previewAction(nextTurn, "hero", source, { kind: "none" }, M0_CONTENT).legal,
    ).toBe(true);
  });

  it("replays accepted commands to the same final state and event sequence", () => {
    const scenario = heroFirstScenario();
    const setup = createM0Combat(scenario, 55);
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

    const replay = replayCombat(
      { scenario, content: M0_CONTENT, contentIdentity: M0_CONTENT_IDENTITY },
      createCombatReplay(state),
    );
    expect(hashCombatState(replay.state)).toBe(hashCombatState(state));
    expect(replay.state.commandLog).toEqual(commands);
    expect(replay.events).toEqual(originalEvents);
  });

  it("rejects replay content identity mismatches before executing commands", () => {
    const scenario = heroFirstScenario();
    const setup = createM0Combat(scenario, 56);
    const replay = createCombatReplay(setup.state);
    const mismatched = {
      ...replay,
      contentIdentity: { ...replay.contentIdentity, fingerprint: "fnv1a64:0000000000000000" },
    };

    expect(() =>
      replayCombat(
        { scenario, content: M0_CONTENT, contentIdentity: M0_CONTENT_IDENTITY },
        mismatched,
      ),
    ).toThrow(/content mismatch/i);
    expect(setup.state.sequence).toBe(0);
    expect(setup.state.commandLog).toEqual([]);
  });

  it("ends in victory when all enemies are defeated", () => {
    const scenario = heroFirstScenario({
      hero: { position: { x: 1, y: 1 }, facing: "east" },
      "goblin-skirmisher": { position: { x: 2, y: 1 }, hp: 1, maxHp: 1, baseAc: -100 },
      "goblin-brute": { position: { x: 1, y: 2 }, hp: 1, maxHp: 1, baseAc: -100 },
    });
    let state = createM0Combat(scenario, 77).state;
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
    let state = createM0Combat(scenario, 66).state;
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
