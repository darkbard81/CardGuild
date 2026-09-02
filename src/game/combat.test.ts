import { describe, expect, it } from "vitest";

import {
  cloneM0Scenario,
  M0_CONTENT,
  M0_CONTENT_IDENTITY,
  M0_DEFAULT_SEED,
} from "../content/load-m0-content";
import { chooseAiCommand } from "./ai";
import { createCombat, dispatchCombatCommand, validateMoveContinuation } from "./engine";
import {
  listLegalActions,
  listLegalTargets,
  previewAction,
  validateActionIntent,
} from "./queries";
import { resolveStrike } from "./offense";
import { createCombatReplay, hashCombatState, replayCombat } from "./replay";
import { resolveArmorClass } from "./statistics";
import { resolveStatisticDC } from "./statistics";
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

type ActorOverride = Partial<ActorSetup> & {
  readonly initiative?: number;
  readonly authoredAc?: number;
};

function withInitiative(actor: ActorSetup, initiative: number): ActorSetup {
  return actor.statProfile.kind === "character"
    ? {
        ...actor,
        statProfile: {
          kind: "character",
          stats: {
            ...actor.statProfile.stats,
            attributes: { ...actor.statProfile.stats.attributes, wis: initiative },
            perception: "untrained",
          },
        },
      }
    : {
        ...actor,
        statProfile: {
          kind: "creature",
          stats: { ...actor.statProfile.stats, perception: initiative },
        },
      };
}

function withAuthoredAc(actor: ActorSetup, ac: number): ActorSetup {
  if (actor.statProfile.kind !== "creature") throw new Error("Only creatures author a fixed AC.");
  return { ...actor, statProfile: { kind: "creature", stats: { ...actor.statProfile.stats, ac } } };
}

function scenarioWith(
  actorOverrides: Readonly<Record<string, ActorOverride>> = {},
): ScenarioDefinition {
  const scenario = cloneM0Scenario();
  return {
    ...scenario,
    actors: scenario.actors.map((actor) => {
      const { initiative, authoredAc, ...override } = actorOverrides[actor.id] ?? {};
      const withAc = { ...actor, ...override };
      const merged = authoredAc === undefined ? withAc : withAuthoredAc(withAc, authoredAc);
      return initiative === undefined ? merged : withInitiative(merged, initiative);
    }),
  };
}

function heroFirstScenario(overrides: Readonly<Record<string, ActorOverride>> = {}): ScenarioDefinition {
  return scenarioWith({
    hero: { initiative: 100, ...overrides.hero },
    "goblin-skirmisher": { initiative: -100, ...overrides["goblin-skirmisher"] },
    "goblin-brute": { initiative: -100, ...overrides["goblin-brute"] },
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

function makeReactionAvailable(state: CombatState, actorId: string): CombatState {
  const actor = state.actors[actorId] as NonNullable<typeof state.actors[string]>;
  const zones = state.cardZones[actorId] as NonNullable<typeof state.cardZones[string]>;
  const card = allCards(state, actorId).find((entry) => entry.definitionId === "card.reactive-strike") as CardInstance;
  return {
    ...state,
    actors: { ...state.actors, [actorId]: { ...actor, reactionAvailable: true } },
    cardZones: {
      ...state.cardZones,
      [actorId]: {
        hand: [card, ...zones.hand.filter((entry) => entry.id !== card.id)],
        drawPile: zones.drawPile.filter((entry) => entry.id !== card.id),
        discardPile: zones.discardPile.filter((entry) => entry.id !== card.id),
      },
    },
  };
}

function twoReactionState(moverHp = 100): CombatState {
  const scenario = cloneM0Scenario();
  const hero = scenario.actors.find((actor) => actor.id === "hero") as ActorSetup;
  const configured: ScenarioDefinition = {
    ...scenario,
    actors: [
      ...scenario.actors.map((actor) => {
        if (actor.id === "hero") return withInitiative({ ...actor, position: { x: 1, y: 1 }, facing: "east" as const }, -100);
        if (actor.id === "goblin-skirmisher") {
          return withInitiative(
            withAuthoredAc({ ...actor, position: { x: 2, y: 1 }, facing: "east" as const, hp: moverHp, maxHp: moverHp }, -100),
            100,
          );
        }
        return withInitiative({ ...actor, position: { x: 8, y: 6 } }, -102);
      }),
      withInitiative({ ...hero, id: "hero-2", position: { x: 2, y: 0 }, facing: "south" }, -101),
    ],
  };
  let state = createM0Combat(configured, 44).state;
  state = makeReactionAvailable(state, "hero");
  return makeReactionAvailable(state, "hero-2");
}

function openTwoReactions(
  state = twoReactionState(),
  destination: { readonly x: number; readonly y: number } = { x: 3, y: 1 },
): CombatState {
  return dispatchCombatCommand(
    state,
    command(
      state,
      "goblin-skirmisher",
      { kind: "basic", id: "stride" },
      { kind: "tile", position: destination, facing: "east" },
    ),
    M0_CONTENT,
  ).state;
}

describe("M0 combat core", () => {
  it("builds an equipment-provenance deck and repeats the same initial hash", () => {
    const first = createM0Combat(cloneM0Scenario(), M0_DEFAULT_SEED).state;
    const second = createM0Combat(cloneM0Scenario(), M0_DEFAULT_SEED).state;
    expect(hashCombatState(first)).toBe(hashCombatState(second));
    expect(hashCombatState(first)).toBe("db862b47690638c2");
    expect(
      Object.values(first.actors).every(
        (actor) => actor.reactionAvailable === (actor.id === first.turn.activeActorId),
      ),
    ).toBe(true);
    expect(first.cardZones.hero?.hand).toHaveLength(6);
    expect(first.cardZones.hero?.drawPile).toHaveLength(2);
    const cards = allCards(first, "hero");
    expect(cards.filter((card) => card.definitionId === "card.trip")).toHaveLength(3);
    expect(cards.filter((card) => card.source.kind === "equipment-trait" && card.source.equipmentId === "halberd")).toHaveLength(3);
    expect(cards.filter((card) => card.definitionId === "card.fly")).toHaveLength(2);
    expect(resolveStatisticDC(
      first.actors.hero as NonNullable<typeof first.actors.hero>,
      { kind: "save", id: "reflex" },
      { content: M0_CONTENT },
    ).value).toBe(16);
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
    expect(resolveArmorClass(
      raised.state.actors.hero as NonNullable<typeof raised.state.actors.hero>,
      { content: M0_CONTENT },
    ).value).toBe(17);

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

  it("does not raise a non-shield item that carries malformed shield data", () => {
    const malformedId = "malformed-shield-boots";
    const malformedContent: CombatContent = {
      ...M0_CONTENT,
      equipment: {
        ...M0_CONTENT.equipment,
        [malformedId]: {
          id: malformedId,
          name: "Malformed Shield Boots",
          slot: "feet",
          traits: [{ id: "shield" }],
          statModifiers: [],
          shieldBonus: 3,
        },
      },
    };
    const state = createM0Combat(heroFirstScenario({ hero: { equipmentIds: [malformedId] } }), 10, malformedContent).state;
    const raise = listLegalActions(state, "hero", malformedContent).find((action) => action.actionId === "raise-shield");
    expect(raise?.enabled).toBe(true);

    const result = dispatchCombatCommand(
      state,
      command(state, "hero", raise?.source as ActionSource, { kind: "none" }),
      malformedContent,
    );
    expect(result.accepted).toBe(true);
    expect(result.state.actors.hero?.shieldRaised).toBe(false);
    expect(result.events.some((event) => event.type === "SHIELD_RAISED")).toBe(false);
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

  it("gives the action preview the same Strike numbers the execution rolls", () => {
    const scenario = heroFirstScenario({
      hero: { position: { x: 1, y: 1 }, facing: "east" },
      "goblin-skirmisher": { position: { x: 2, y: 1 }, hp: 100, maxHp: 100 },
      "goblin-brute": { position: { x: 8, y: 6 } },
    });
    let state = createM0Combat(scenario, 33).state;
    const previews: string[][] = [];
    for (let index = 0; index < 3; index += 1) {
      const source: ActionSource = { kind: "basic", id: "strike" };
      const target = { kind: "actor" as const, actorId: "goblin-skirmisher" };
      const preview = previewAction(state, "hero", source, target, M0_CONTENT);
      const result = dispatchCombatCommand(state, command(state, "hero", source, target), M0_CONTENT);
      const check = result.events.find((event) => event.type === "CHECK_ROLLED");
      expect(check?.type === "CHECK_ROLLED" ? check.modifierSources : []).toEqual(preview.notes);
      previews.push([...preview.notes]);
      state = result.state;
    }
    // Each view walks the same MAP ladder because both read the one resolver.
    expect(previews[0]).not.toContain("Multiple attack penalty -5");
    expect(previews[1]).toContain("Multiple attack penalty -5");
    expect(previews[2]).toContain("Multiple attack penalty -10");
  });

  it("deals at least 1 damage when penalties sink the Strike, and doubles that on a critical", () => {
    // A large authored damage penalty is legal now that damage has its own modifier stack.
    const drainedContent: CombatContent = {
      ...M0_CONTENT,
      conditions: {
        ...M0_CONTENT.conditions,
        "damage-drained": {
          id: "damage-drained",
          name: "Damage Drained",
          traits: [],
          statModifiers: [{ selector: { kind: "damage" }, type: "untyped", value: -30, label: "Damage drained" }],
        },
      },
    };
    const scenario = heroFirstScenario({
      hero: { position: { x: 1, y: 1 }, facing: "east", conditions: [{ id: "damage-drained", sourceId: "test" }] },
      // A trivially low AC makes the outcome a critical success on every die face.
      "goblin-skirmisher": { position: { x: 2, y: 1 }, hp: 100, maxHp: 100, authoredAc: -100 },
      "goblin-brute": { position: { x: 8, y: 6 } },
    });
    const state = createM0Combat(scenario, 33, drainedContent).state;

    const preview = previewAction(state, "hero", { kind: "basic", id: "strike" }, { kind: "actor", actorId: "goblin-skirmisher" }, drainedContent);
    expect(preview.damageRange).toEqual([1, 1]);

    const result = dispatchCombatCommand(
      state,
      command(state, "hero", { kind: "basic", id: "strike" }, { kind: "actor", actorId: "goblin-skirmisher" }),
      drainedContent,
    );
    const check = result.events.find((event) => event.type === "CHECK_ROLLED");
    const dealt = result.events.find((event) => event.type === "DAMAGE_DEALT");
    expect(check?.type === "CHECK_ROLLED" ? check.degree : null).toBe("critical-success");
    // Minimum first, doubling second: 2, never 0.
    expect(dealt?.type === "DAMAGE_DEALT" ? dealt.amount : null).toBe(2);
  });

  it("keeps a Creature's authored Strike out of the Character weapon formula", () => {
    const scenario = scenarioWith({
      hero: { position: { x: 1, y: 1 }, hp: 100, maxHp: 100, initiative: -100 },
      "goblin-skirmisher": { position: { x: 2, y: 1 }, facing: "west", initiative: 100 },
      "goblin-brute": { position: { x: 8, y: 6 }, initiative: -101 },
    });
    const state = createM0Combat(scenario, 21).state;
    const result = dispatchCombatCommand(
      state,
      command(state, "goblin-skirmisher", { kind: "basic", id: "strike" }, { kind: "actor", actorId: "hero" }),
      M0_CONTENT,
    );
    expect(result.accepted).toBe(true);
    const check = result.events.find((event) => event.type === "CHECK_ROLLED");
    expect(check?.type === "CHECK_ROLLED" ? check.modifier : null).toBe(6);
    expect(check?.type === "CHECK_ROLLED" ? check.modifierSources.slice(0, 2) : []).toEqual([
      "Goblin Blade",
      "Authored Goblin Blade +6",
    ]);
  });

  it("charges a two-action activity before rejecting another unaffordable use", () => {
    const scenario = scenarioWith({
      hero: { position: { x: 1, y: 1 }, hp: 100, maxHp: 100, initiative: -100 },
      "goblin-skirmisher": { position: { x: 8, y: 6 }, initiative: -101 },
      "goblin-brute": {
        position: { x: 2, y: 1 },
        facing: "west",
        initiative: 100,
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
      hero: { position: { x: 1, y: 1 }, facing: "east", initiative: -100 },
      "goblin-skirmisher": {
        position: { x: 2, y: 1 },
        facing: "east",
        initiative: 100,
        hp: 100,
        maxHp: 100,
      },
      "goblin-brute": { position: { x: 8, y: 6 }, initiative: -101 },
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
    // The Reactive Strike reads the same offense resolver a normal Strike does.
    const reactor = movement.state.actors.hero as NonNullable<CombatState["actors"][string]>;
    const reactiveCheck = reaction.events.find((event) => event.type === "CHECK_ROLLED");
    expect(reactiveCheck?.type === "CHECK_ROLLED" ? reactiveCheck.modifier : null)
      .toBe(resolveStrike(reactor, { content: M0_CONTENT }).attackModifier);

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

  it("resolves multiple reactions strictly from the deterministic head of the queue", () => {
    const opened = openTwoReactions();
    const pending = opened.pendingReaction as NonNullable<CombatState["pendingReaction"]>;
    expect(pending.candidates.map((candidate) => candidate.actorId)).toEqual(["hero", "hero-2"]);

    const nonHeadPass = dispatchCombatCommand(opened, {
      type: "pass-reaction",
      id: "non-head-pass",
      sequence: opened.sequence + 1,
      actorId: "hero-2",
      triggerId: pending.triggerId,
    }, M0_CONTENT);
    expect(nonHeadPass.accepted).toBe(false);
    expect(nonHeadPass.state).toBe(opened);

    const nonHead = pending.candidates[1] as NonNullable<typeof pending.candidates[number]>;
    const nonHeadUse = dispatchCombatCommand(opened, {
      type: "use-reaction",
      id: "non-head-use",
      sequence: opened.sequence + 1,
      actorId: nonHead.actorId,
      triggerId: pending.triggerId,
      cardInstanceId: nonHead.cardInstanceId,
    }, M0_CONTENT);
    expect(nonHeadUse.accepted).toBe(false);
    expect(nonHeadUse.state).toBe(opened);

    const head = pending.candidates[0] as NonNullable<typeof pending.candidates[number]>;
    const used = dispatchCombatCommand(opened, {
      type: "use-reaction",
      id: "head-use",
      sequence: opened.sequence + 1,
      actorId: head.actorId,
      triggerId: pending.triggerId,
      cardInstanceId: head.cardInstanceId,
    }, M0_CONTENT);
    expect(used.accepted).toBe(true);
    expect(used.state.pendingReaction?.candidates.map((candidate) => candidate.actorId)).toEqual(["hero-2"]);
    expect(used.state.actors["goblin-skirmisher"]?.position).toEqual({ x: 2, y: 1 });

    const passed = dispatchCombatCommand(used.state, {
      type: "pass-reaction",
      id: "next-pass",
      sequence: used.state.sequence + 1,
      actorId: "hero-2",
      triggerId: pending.triggerId,
    }, M0_CONTENT);
    expect(passed.accepted).toBe(true);
    expect(passed.state.pendingReaction).toBeNull();
    expect(passed.state.actors["goblin-skirmisher"]?.position).toEqual({ x: 3, y: 1 });
  });

  it("keeps reaction events and final hashes independent of reversed arrival attempts", () => {
    const resolve = (sendNonHeadFirst: boolean) => {
      let state = openTwoReactions();
      const triggerId = state.pendingReaction?.triggerId as string;
      if (sendNonHeadFirst) {
        const rejected = dispatchCombatCommand(state, {
          type: "pass-reaction",
          id: "arrival-out-of-order",
          sequence: state.sequence + 1,
          actorId: "hero-2",
          triggerId,
        }, M0_CONTENT);
        expect(rejected.accepted).toBe(false);
        expect(rejected.state).toBe(state);
      }
      const events: unknown[] = [];
      for (const [id, actorId] of [["ordered-head", "hero"], ["ordered-next", "hero-2"]] as const) {
        const result = dispatchCombatCommand(state, {
          type: "pass-reaction",
          id,
          sequence: state.sequence + 1,
          actorId,
          triggerId,
        }, M0_CONTENT);
        expect(result.accepted).toBe(true);
        events.push(...result.events);
        state = result.state;
      }
      return { state, events };
    };

    const ordered = resolve(false);
    const reversed = resolve(true);
    expect(reversed.events).toEqual(ordered.events);
    expect(hashCombatState(reversed.state)).toBe(hashCombatState(ordered.state));
  });

  it("revalidates remaining candidates and cancels continuation when the first reaction defeats the mover", () => {
    const opened = openTwoReactions(twoReactionState(1));
    const pending = opened.pendingReaction as NonNullable<CombatState["pendingReaction"]>;
    const head = pending.candidates[0] as NonNullable<typeof pending.candidates[number]>;
    const killed = dispatchCombatCommand(opened, {
      type: "use-reaction",
      id: "lethal-head-use",
      sequence: opened.sequence + 1,
      actorId: head.actorId,
      triggerId: pending.triggerId,
      cardInstanceId: head.cardInstanceId,
    }, M0_CONTENT);

    expect(killed.accepted).toBe(true);
    expect(killed.state.actors["goblin-skirmisher"]?.defeated).toBe(true);
    expect(killed.state.pendingReaction).toBeNull();
    expect(killed.events.some((event) => event.type === "ACTOR_MOVED")).toBe(false);

    const invalidatedBase = openTwoReactions();
    const invalidated: CombatState = {
      ...invalidatedBase,
      actors: {
        ...invalidatedBase.actors,
        "hero-2": {
          ...(invalidatedBase.actors["hero-2"] as NonNullable<typeof opened.actors[string]>),
          reactionAvailable: false,
        },
      },
    };
    const invalidatedPending = invalidated.pendingReaction as NonNullable<CombatState["pendingReaction"]>;
    const invalidatedHead = invalidatedPending.candidates[0] as NonNullable<typeof invalidatedPending.candidates[number]>;
    const skipped = dispatchCombatCommand(invalidated, {
      type: "use-reaction",
      id: "skip-invalid-next",
      sequence: invalidated.sequence + 1,
      actorId: invalidatedHead.actorId,
      triggerId: invalidatedPending.triggerId,
      cardInstanceId: invalidatedHead.cardInstanceId,
    }, M0_CONTENT);
    expect(skipped.state.pendingReaction).toBeNull();
    expect(skipped.state.actors["goblin-skirmisher"]?.position).toEqual({ x: 3, y: 1 });
  });

  it("cancels a reaction continuation when its destination becomes occupied or its original path changes", () => {
    const occupiedBase = openTwoReactions();
    const brute = occupiedBase.actors["goblin-brute"] as NonNullable<typeof occupiedBase.actors[string]>;
    const occupied: CombatState = {
      ...occupiedBase,
      actors: {
        ...occupiedBase.actors,
        [brute.id]: { ...brute, position: { x: 3, y: 1 } },
      },
    };
    const occupiedPending = occupied.pendingReaction as NonNullable<CombatState["pendingReaction"]>;
    expect(validateMoveContinuation(occupied, occupiedPending.continuation, M0_CONTENT).legal).toBe(false);
    const occupiedPass = dispatchCombatCommand(occupied, {
      type: "pass-reaction",
      id: "occupied-continuation-pass",
      sequence: occupied.sequence + 1,
      actorId: occupiedPending.candidates[0]?.actorId as string,
      triggerId: occupiedPending.triggerId,
    }, M0_CONTENT);
    expect(occupiedPass.accepted).toBe(true);
    expect(occupiedPass.state.pendingReaction).toBeNull();
    expect(occupiedPass.state.actors["goblin-skirmisher"]?.position).toEqual({ x: 2, y: 1 });
    expect(occupiedPass.events.some((event) => event.type === "ACTOR_MOVED")).toBe(false);

    const originalPath = openTwoReactions(twoReactionState(), { x: 3, y: 2 });
    const pathPending = originalPath.pendingReaction as NonNullable<CombatState["pendingReaction"]>;
    expect(pathPending.continuation.path).toEqual([{ x: 3, y: 1 }, { x: 3, y: 2 }]);
    const pathTile = originalPath.map.tiles["3,1"] as NonNullable<typeof originalPath.map.tiles[string]>;
    const changedPath: CombatState = {
      ...originalPath,
      map: {
        ...originalPath.map,
        tiles: {
          ...originalPath.map.tiles,
          "3,1": { ...pathTile, traits: [...pathTile.traits, { id: "blocked" }] },
        },
      },
    };
    const withoutBoundary: CombatState = { ...changedPath, pendingReaction: null };
    expect(listLegalTargets(withoutBoundary, "goblin-skirmisher", { kind: "basic", id: "stride" }, M0_CONTENT))
      .toContainEqual(expect.objectContaining({ kind: "tile", position: { x: 3, y: 2 } }));
    expect(validateMoveContinuation(changedPath, pathPending.continuation, M0_CONTENT).legal).toBe(false);
    const changedPathPass = dispatchCombatCommand(changedPath, {
      type: "pass-reaction",
      id: "changed-path-pass",
      sequence: changedPath.sequence + 1,
      actorId: pathPending.candidates[0]?.actorId as string,
      triggerId: pathPending.triggerId,
    }, M0_CONTENT);
    expect(changedPathPass.accepted).toBe(true);
    expect(changedPathPass.state.pendingReaction).toBeNull();
    expect(changedPathPass.state.actors["goblin-skirmisher"]?.position).toEqual({ x: 2, y: 1 });
    expect(changedPathPass.events.some((event) => event.type === "ACTOR_MOVED")).toBe(false);
  });

  it("opens a movement reaction for Stride but never for Step", () => {
    const scenario = scenarioWith({
      hero: { position: { x: 1, y: 1 }, facing: "east", initiative: -100 },
      "goblin-skirmisher": {
        position: { x: 2, y: 1 },
        facing: "east",
        initiative: 100,
        hp: 100,
        maxHp: 100,
      },
      "goblin-brute": { position: { x: 8, y: 6 }, initiative: -101 },
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
      hero: { position: { x: 1, y: 1 }, facing: "east", initiative: -100 },
      "goblin-skirmisher": {
        position: { x: 2, y: 1 },
        facing: "east",
        initiative: 100,
        hp: 100,
        maxHp: 100,
      },
      "goblin-brute": { position: { x: 8, y: 6 }, initiative: -101 },
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
      resolution: { kind: "direct", effects: [{ kind: "remove-condition", owner: "actor", condition: "test-condition" }] },
    };
    const providerContent: CombatContent = {
      ...M0_CONTENT,
      actions: { ...M0_CONTENT.actions, [recoverTest.id]: recoverTest },
      equipment: {
        ...M0_CONTENT.equipment,
        "trait-only-kit": {
          id: "trait-only-kit",
          name: "Trait-only Kit",
          slot: "shield",
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
        deckContributions: [
          {
            cardDefinitionId: "card.trip",
            count: 3,
            source: { kind: "equipment-trait", equipmentId: "trait-only-kit", traitId: "trip" },
          },
          {
            cardDefinitionId: "card.fly",
            count: 2,
            source: { kind: "equipment-trait", equipmentId: "trait-only-kit", traitId: "fly" },
          },
        ],
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
        .every((card) => card.source.kind === "equipment-trait" && card.source.equipmentId === "trait-only-kit"),
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
      hero: { position: { x: 1, y: 1 }, facing: "east", initiative: -100 },
      "goblin-skirmisher": {
        position: { x: 2, y: 1 },
        facing: "east",
        initiative: 100,
      },
      "goblin-brute": { position: { x: 8, y: 6 }, initiative: -101 },
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

  it("changes setup identity with loadout-derived actor setup and fails before replay commands", () => {
    const scenario = heroFirstScenario();
    const setup = createM0Combat(scenario, 57);
    const replay = createCombatReplay(setup.state);
    const hero = scenario.actors.find((actor) => actor.id === "hero") as ActorSetup;
    const changedScenario: ScenarioDefinition = {
      ...scenario,
      actors: scenario.actors.map((actor) => actor.id === hero.id
        ? {
            ...actor,
            equipmentIds: actor.equipmentIds.filter((id) => id !== "boots-of-fly"),
            deckContributions: actor.deckContributions.filter(
              (entry) => entry.source.kind !== "equipment-trait" || entry.source.equipmentId !== "boots-of-fly",
            ),
          }
        : actor),
    };
    const changed = createM0Combat(changedScenario, 57);
    const statChangedScenario: ScenarioDefinition = {
      ...scenario,
      actors: scenario.actors.map((actor) => actor.id === hero.id
        ? actor.statProfile.kind === "character"
          ? {
              ...actor,
              statProfile: {
                kind: "character",
                stats: {
                  ...actor.statProfile.stats,
                  attributes: {
                    ...actor.statProfile.stats.attributes,
                    dex: actor.statProfile.stats.attributes.dex + 1,
                  },
                },
              },
            }
          : {
              ...actor,
              statProfile: {
                kind: "creature",
                stats: {
                  ...actor.statProfile.stats,
                  saves: {
                    ...actor.statProfile.stats.saves,
                    reflex: actor.statProfile.stats.saves.reflex + 1,
                  },
                },
              },
            }
        : actor),
    };
    const statChanged = createM0Combat(statChangedScenario, 57);

    expect(changed.state.setupFingerprint).not.toBe(setup.state.setupFingerprint);
    expect(statChanged.state.setupFingerprint).not.toBe(setup.state.setupFingerprint);
    expect(() => replayCombat(
      { scenario: changedScenario, content: M0_CONTENT, contentIdentity: M0_CONTENT_IDENTITY },
      replay,
    )).toThrow(/setup mismatch/i);
    expect(replay.commands).toEqual([]);
  });

  it("clones nested character profiles instead of sharing them across states", () => {
    const state = createM0Combat(heroFirstScenario({
      hero: { position: { x: 1, y: 1 }, facing: "east" },
      "goblin-skirmisher": { position: { x: 2, y: 1 }, authoredAc: -100 },
    }), 12).state;
    const struck = dispatchCombatCommand(
      state,
      command(state, "hero", { kind: "basic", id: "strike" }, { kind: "actor", actorId: "goblin-skirmisher" }),
      M0_CONTENT,
    );
    const before = state.actors.hero?.statProfile;
    const after = struck.state.actors.hero?.statProfile;
    if (before?.kind !== "character" || after?.kind !== "character") throw new Error("The M0 hero must be a character.");

    expect(after).toEqual(before);
    expect(after.stats.defense).not.toBe(before.stats.defense);
    expect(after.stats.defense.armorProficiencies).not.toBe(before.stats.defense.armorProficiencies);
    expect(after.stats.attributes).not.toBe(before.stats.attributes);
  });

  it("mutates only current HP on damage and keeps derived maximum HP intact", () => {
    const scenario = heroFirstScenario({
      hero: { position: { x: 1, y: 1 }, facing: "east" },
      "goblin-skirmisher": { position: { x: 2, y: 1 }, authoredAc: -100 },
    });
    const state = createM0Combat(scenario, 91).state;
    const before = state.actors["goblin-skirmisher"] as NonNullable<typeof state.actors["goblin-skirmisher"]>;
    expect(before.hp).toBe(before.maxHp);

    const struck = dispatchCombatCommand(
      state,
      command(state, "hero", { kind: "basic", id: "strike" }, { kind: "actor", actorId: "goblin-skirmisher" }),
      M0_CONTENT,
    );
    const after = struck.state.actors["goblin-skirmisher"] as NonNullable<typeof state.actors["goblin-skirmisher"]>;

    expect(struck.accepted).toBe(true);
    expect(after.hp).toBeLessThan(before.hp);
    expect(after.maxHp).toBe(before.maxHp);
  });

  it("ends in victory when all enemies are defeated", () => {
    const scenario = heroFirstScenario({
      hero: { position: { x: 1, y: 1 }, facing: "east" },
      "goblin-skirmisher": { position: { x: 2, y: 1 }, hp: 1, maxHp: 1, authoredAc: -100 },
      "goblin-brute": { position: { x: 1, y: 2 }, hp: 1, maxHp: 1, authoredAc: -100 },
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
      hero: { hp: 1, maxHp: 1, position: { x: 5, y: 2 }, initiative: -100 },
      "goblin-skirmisher": { position: { x: 6, y: 2 }, facing: "west", initiative: 100 },
      "goblin-brute": { position: { x: 8, y: 6 }, initiative: -101 },
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
