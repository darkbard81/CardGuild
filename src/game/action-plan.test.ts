import { describe, expect, it } from "vitest";

import { M6_COMBAT_DEFINITION, M6_CONTENT } from "../content/load-m6-content";
import { buildResolvedActionPlan, resolveActionStatistic, turnMapContext } from "./action-plan";
import { degreeProbabilities } from "./checks";
import { createCombat, dispatchCombatCommand } from "./engine";
import { previewAction } from "./queries";
import { hashCombatState } from "./replay";
import { resolveClassDC, resolveStatisticDC, resolveStatisticModifier } from "./statistics";
import type {
  ActionDcRef,
  ActionDefinition,
  ActionSource,
  ActionTarget,
  ActorSetup,
  CardInstance,
  CombatCommand,
  CombatState,
  ScenarioDefinition,
} from "./types";

function scenarioWith(overrides: Readonly<Record<string, Partial<ActorSetup>>>): ScenarioDefinition {
  const scenario = M6_COMBAT_DEFINITION.scenario;
  return {
    ...scenario,
    actors: scenario.actors.map((actor) => ({ ...actor, ...overrides[actor.id] })),
  };
}

/** Aerin acts first, the skirmisher stands one square east of her, and nothing else moves. */
function heroFirst(overrides: Readonly<Record<string, Partial<ActorSetup>>> = {}): CombatState {
  const withInitiative = (actor: ActorSetup, wisdom: number): Partial<ActorSetup> =>
    actor.statProfile.kind === "character"
      ? {
          statProfile: {
            kind: "character",
            stats: { ...actor.statProfile.stats, attributes: { ...actor.statProfile.stats.attributes, wis: wisdom } },
          },
        }
      : { statProfile: { kind: "creature", stats: { ...actor.statProfile.stats, perception: wisdom } } };
  const base = M6_COMBAT_DEFINITION.scenario.actors;
  const hero = base.find((actor) => actor.id === "hero") as ActorSetup;
  const skirmisher = base.find((actor) => actor.id === "goblin-skirmisher") as ActorSetup;
  const scenario = scenarioWith({
    hero: { position: { x: 1, y: 1 }, facing: "east", ...withInitiative(hero, 100), ...overrides.hero },
    "goblin-skirmisher": {
      position: { x: 2, y: 1 },
      facing: "west",
      hp: 100,
      maxHp: 100,
      ...withInitiative(skirmisher, -100),
      ...overrides["goblin-skirmisher"],
    },
    "goblin-brute": { position: { x: 8, y: 6 }, ...withInitiative(base.find((actor) => actor.id === "goblin-brute") as ActorSetup, -101) },
  });
  return createCombat({ ...M6_COMBAT_DEFINITION, scenario }, 33).state;
}

function useAction(state: CombatState, source: ActionSource, target: ActionTarget): CombatCommand {
  return {
    type: "use-action",
    id: `plan-${state.sequence + 1}`,
    sequence: state.sequence + 1,
    actorId: state.turn.activeActorId,
    action: source,
    target,
  };
}

/** Puts a card definition into the actor's hand so a Card source can be exercised. */
function withCardInHand(state: CombatState, actorId: string, cardDefinitionId: string): {
  readonly state: CombatState;
  readonly card: CardInstance;
} {
  const zones = state.cardZones[actorId] as NonNullable<CombatState["cardZones"][string]>;
  const card: CardInstance = {
    id: `card-injected-${cardDefinitionId}`,
    definitionId: cardDefinitionId,
    source: { kind: "base", sourceId: "test" },
  };
  return {
    card,
    state: { ...state, cardZones: { ...state.cardZones, [actorId]: { ...zones, hand: [card, ...zones.hand] } } },
  };
}

const ENEMY: ActionTarget = { kind: "actor", actorId: "goblin-skirmisher" };

describe("resolved action plan", () => {
  it("composes DCs out of the Armor Class, statistic DC, and Class DC resolvers", () => {
    const state = heroFirst();
    const hero = state.actors.hero as NonNullable<CombatState["actors"][string]>;
    const goblin = state.actors["goblin-skirmisher"] as NonNullable<CombatState["actors"][string]>;
    const context = { content: M6_CONTENT };

    const strike = buildResolvedActionPlan(
      M6_CONTENT.actions.strike as NonNullable<(typeof M6_CONTENT.actions)["strike"]>,
      hero, ENEMY, { kind: "basic", id: "strike" }, state, M6_CONTENT, turnMapContext(state),
    );
    const trip = buildResolvedActionPlan(
      M6_CONTENT.actions.trip as NonNullable<(typeof M6_CONTENT.actions)["trip"]>,
      hero, ENEMY, { kind: "basic", id: "strike" }, state, M6_CONTENT, turnMapContext(state),
    );
    const escape = buildResolvedActionPlan(
      M6_CONTENT.actions["escape-grab"] as NonNullable<(typeof M6_CONTENT.actions)["escape-grab"]>,
      hero, { kind: "none" }, { kind: "context", id: "escape-grab" }, state, M6_CONTENT, turnMapContext(state),
    );
    if (strike?.resolution.kind !== "strike" || trip?.resolution.kind !== "check" || escape?.resolution.kind !== "check") {
      throw new Error("Plans did not resolve.");
    }

    // Strike: #9 attack modifier against the #8 Armor Class.
    expect(strike.resolution.check.dc).toBe(16);
    expect(strike.resolution.check.modifier).toBe(8);
    // Trip: #7 Athletics against the target's #7 Reflex DC — no trip-specific arithmetic.
    expect(trip.resolution.check.modifier)
      .toBe(resolveStatisticModifier(hero, { kind: "skill", id: "athletics" }, context).value);
    expect(trip.resolution.check.dc)
      .toBe(resolveStatisticDC(goblin, { kind: "save", id: "reflex" }, context).value);
    // Escape: #7 Athletics against an authored fixed DC.
    expect(escape.resolution.check.dc).toBe(15);
    expect(escape.resolution.check.rollerActorId).toBe("hero");
    // Class DC stays available through #9 and is distinct from every DC above.
    expect(resolveClassDC(hero, context).value).toBe(16);
  });

  it("resolves Class DC for Character owners and returns null for Creature owners", () => {
    const state = heroFirst();
    const hero = state.actors.hero as NonNullable<CombatState["actors"][string]>;
    const goblin = state.actors["goblin-skirmisher"] as NonNullable<CombatState["actors"][string]>;
    const trip = M6_CONTENT.actions.trip as NonNullable<(typeof M6_CONTENT.actions)["trip"]>;
    if (trip.resolution.kind !== "check") throw new Error("M6 Trip fixture is missing.");
    const tripResolution = trip.resolution;
    const withDc = (dc: ActionDcRef): ActionDefinition => ({
      ...trip,
      resolution: { ...tripResolution, check: { ...tripResolution.check, dc } },
    });
    const characterTargetId = "character-target";
    const withCharacterTarget: CombatState = {
      ...state,
      actors: { ...state.actors, [characterTargetId]: { ...hero, id: characterTargetId } },
    };
    const characterTarget: ActionTarget = { kind: "actor", actorId: characterTargetId };
    const source: ActionSource = { kind: "basic", id: "trip" };

    const actorClassDc = buildResolvedActionPlan(
      withDc({ kind: "class-dc", owner: "actor" }),
      hero,
      ENEMY,
      source,
      state,
      M6_CONTENT,
      turnMapContext(state),
    );
    const targetClassDc = buildResolvedActionPlan(
      withDc({ kind: "class-dc", owner: "target" }),
      hero,
      characterTarget,
      source,
      withCharacterTarget,
      M6_CONTENT,
      turnMapContext(withCharacterTarget),
    );
    if (actorClassDc?.resolution.kind !== "check" || targetClassDc?.resolution.kind !== "check") {
      throw new Error("Character Class DC plans did not resolve.");
    }
    expect(actorClassDc.resolution.check.dc).toBe(resolveClassDC(hero, { content: M6_CONTENT }).value);
    expect(targetClassDc.resolution.check.dc).toBe(resolveClassDC(
      withCharacterTarget.actors[characterTargetId] as NonNullable<CombatState["actors"][string]>,
      { content: M6_CONTENT },
    ).value);

    const creatureTargetPlan = () => buildResolvedActionPlan(
      withDc({ kind: "class-dc", owner: "target" }),
      hero,
      ENEMY,
      source,
      state,
      M6_CONTENT,
      turnMapContext(state),
    );
    const creatureActorPlan = () => buildResolvedActionPlan(
      withDc({ kind: "class-dc", owner: "actor" }),
      goblin,
      characterTarget,
      source,
      withCharacterTarget,
      M6_CONTENT,
      turnMapContext(withCharacterTarget),
    );
    expect(creatureTargetPlan).not.toThrow();
    expect(creatureActorPlan).not.toThrow();
    expect(creatureTargetPlan()).toBeNull();
    expect(creatureActorPlan()).toBeNull();
  });

  it("reads a Skill's default Attribute and honours an override without touching the rank", () => {
    // Authored Attributes, not the initiative-forcing fixture, so WIS stays Aerin's own.
    const state = createCombat(M6_COMBAT_DEFINITION, 33).state;
    const hero = state.actors.hero as NonNullable<CombatState["actors"][string]>;
    const context = { content: M6_CONTENT };
    const before = structuredClone(hero.statProfile);

    const byDefault = resolveActionStatistic(hero, { kind: "skill", skill: "arcana" }, context);
    const overridden = resolveActionStatistic(hero, { kind: "skill", skill: "arcana", attributeOverride: "wis" }, context);

    // Aerin: INT +1, WIS +3, arcana trained (+3) at level 1.
    expect(byDefault.value).toBe(4);
    expect(overridden.value).toBe(6);
    expect(overridden.sources.map((source) => source.label)).toEqual(["WIS", "Trained proficiency"]);
    // The override selects an already-stored Attribute; it never rewrites the Character.
    expect(hero.statProfile).toEqual(before);
  });

  it("applies MAP inside the turn sequence and never off-turn", () => {
    const state = heroFirst();
    const hero = state.actors.hero as NonNullable<CombatState["actors"][string]>;
    const strike = M6_CONTENT.actions.strike as NonNullable<(typeof M6_CONTENT.actions)["strike"]>;
    const source: ActionSource = { kind: "basic", id: "strike" };
    const secondAttack: CombatState = { ...state, turn: { ...state.turn, attacksThisTurn: 1 } };

    const first = buildResolvedActionPlan(strike, hero, ENEMY, source, state, M6_CONTENT, turnMapContext(state));
    const second = buildResolvedActionPlan(strike, hero, ENEMY, source, secondAttack, M6_CONTENT, turnMapContext(secondAttack));
    const offTurn = buildResolvedActionPlan(strike, hero, ENEMY, source, secondAttack, M6_CONTENT, { kind: "off-turn" });
    if (first?.resolution.kind !== "strike" || second?.resolution.kind !== "strike" || offTurn?.resolution.kind !== "strike") {
      throw new Error("Plans did not resolve.");
    }
    expect([first.resolution.check.modifier, second.resolution.check.modifier]).toEqual([8, 3]);
    // A Reaction resolves off-turn, so the same state produces the unpenalised Strike.
    expect(offTurn.resolution.check.modifier).toBe(8);
  });

  it("previews the plan the executor rolls, without consuming the RNG", () => {
    const state = heroFirst();
    const hero = state.actors.hero as NonNullable<CombatState["actors"][string]>;
    const source: ActionSource = { kind: "basic", id: "strike" };
    const rngBefore = structuredClone(state.rng);

    const preview = previewAction(state, "hero", source, ENEMY, M6_CONTENT);
    expect(state.rng).toEqual(rngBefore);
    expect(preview.degreeProbabilities).toBeDefined();

    const plan = buildResolvedActionPlan(
      M6_CONTENT.actions.strike as NonNullable<(typeof M6_CONTENT.actions)["strike"]>,
      hero, ENEMY, source, state, M6_CONTENT, turnMapContext(state),
    );
    const result = dispatchCombatCommand(state, useAction(state, source, ENEMY), M6_CONTENT);
    const check = result.events.find((event) => event.type === "CHECK_ROLLED");
    if (check?.type !== "CHECK_ROLLED" || plan?.resolution.kind !== "strike") throw new Error("Strike did not resolve.");
    expect([check.modifier, check.dc]).toEqual([plan.resolution.check.modifier, plan.resolution.check.dc]);
    expect(check.modifierSources).toEqual(preview.notes);
    expect(preview.check?.roller).toBe("actor");
    expect(preview.hitChance).toBeDefined();
    expect(preview.criticalChance).toBeDefined();
  });
});

describe("target-side save resolution", () => {
  function castSpiritLance(seed = 33) {
    const opened = heroFirst();
    const injected = withCardInHand(opened, "hero", "card.spirit-lance");
    const source: ActionSource = { kind: "card", id: injected.card.id };
    return {
      ...injected,
      source,
      result: dispatchCombatCommand(injected.state, useAction(injected.state, source, ENEMY), M6_CONTENT),
      seed,
    };
  }

  it("lets the target roll the save against the acting Character's DC", () => {
    const { state, result } = castSpiritLance();
    expect(result.accepted).toBe(true);
    const check = result.events.find((event) => event.type === "CHECK_ROLLED");
    if (check?.type !== "CHECK_ROLLED") throw new Error("Spirit Lance did not roll a check.");

    const goblin = state.actors["goblin-skirmisher"] as NonNullable<CombatState["actors"][string]>;
    const hero = state.actors.hero as NonNullable<CombatState["actors"][string]>;
    // The target rolls its own #7 Reflex; the DC is the caster's authored Skill DC.
    expect(check.rollerActorId).toBe("goblin-skirmisher");
    expect(check.actionActorId).toBe("hero");
    expect(check.modifier).toBe(resolveStatisticModifier(goblin, { kind: "save", id: "reflex" }, { content: M6_CONTENT }).value);
    expect(check.dc).toBe(
      resolveStatisticDC(hero, { kind: "skill", id: "arcana", attributeOverride: "wis" }, { content: M6_CONTENT }).value,
    );
    // No Actor carries a spell attack or spell DC field of its own.
    expect(hero.statProfile.kind === "character" ? hero.statProfile.stats : {}).not.toHaveProperty("spellDc");
  });

  it("previews target-side saves from the target roller's perspective without legacy hit labels", () => {
    const { state, source } = castSpiritLance();
    const goblin = state.actors["goblin-skirmisher"] as NonNullable<CombatState["actors"][string]>;
    const hero = state.actors.hero as NonNullable<CombatState["actors"][string]>;
    const modifier = resolveStatisticModifier(goblin, { kind: "save", id: "reflex" }, { content: M6_CONTENT }).value;
    const dc = resolveStatisticDC(
      hero,
      { kind: "skill", id: "arcana", attributeOverride: "wis" },
      { content: M6_CONTENT },
    ).value;

    const preview = previewAction(state, "hero", source, ENEMY, M6_CONTENT);
    expect(preview.check).toEqual({
      roller: "target",
      rollerActorId: "goblin-skirmisher",
      modifier,
      dc,
    });
    expect(preview.degreeProbabilities).toEqual(degreeProbabilities(modifier, dc));
    expect(preview).not.toHaveProperty("hitChance");
    expect(preview).not.toHaveProperty("criticalChance");
  });

  it("runs a spell-tagged Card through the ordinary Card path and degree outcomes", () => {
    const { result } = castSpiritLance();
    const spell = M6_CONTENT.actions["spirit-lance"] as NonNullable<(typeof M6_CONTENT.actions)["spirit-lance"]>;
    expect(spell.traits.map((trait) => trait.id)).toContain("spell");
    expect(spell.resolution.kind).toBe("check");

    const check = result.events.find((event) => event.type === "CHECK_ROLLED");
    const damage = result.events.find((event) => event.type === "DAMAGE_DEALT");
    if (check?.type !== "CHECK_ROLLED") throw new Error("Spirit Lance did not roll a check.");
    // Degrees are the target's: a successful save takes less, a failed one takes more.
    const expected: Readonly<Record<string, number | null>> = {
      "critical-success": null, success: 1, failure: 2, "critical-failure": 2,
    };
    const dice = expected[check.degree];
    if (dice === null) {
      expect(damage).toBeUndefined();
    } else {
      expect(damage?.type === "DAMAGE_DEALT" ? damage.damageType : null).toBe("force");
      expect(damage?.type === "DAMAGE_DEALT" ? damage.amount : 0).toBeGreaterThanOrEqual(dice as number);
    }
    // The Card was spent through the same discard path any Card uses.
    expect(result.events.some((event) => event.type === "CARD_PLAYED" || event.type === "ACTION_SPENT")).toBe(true);
  });

  it("replays a target-side save to the same events and hash", () => {
    const first = castSpiritLance();
    const second = castSpiritLance();
    expect(second.result.events).toEqual(first.result.events);
    expect(hashCombatState(second.result.state)).toBe(hashCombatState(first.result.state));
  });
});

describe("card and action ownership", () => {
  it("keeps every Card a reference to an Action rather than a rules definition", () => {
    for (const card of Object.values(M6_CONTENT.cards)) {
      expect(Object.keys(card).sort()).toEqual(["actionId", "id", "name", "traits"]);
      expect(M6_CONTENT.actions[card.actionId]).toBeDefined();
    }
  });

  it("resolves a Card source and a basic source to the same Action execution", () => {
    const state = heroFirst();
    const injected = withCardInHand(state, "hero", "card.spirit-beacon");
    const cardPlan = buildResolvedActionPlan(
      M6_CONTENT.actions["spirit-beacon"] as NonNullable<(typeof M6_CONTENT.actions)["spirit-beacon"]>,
      injected.state.actors.hero as NonNullable<CombatState["actors"][string]>,
      { kind: "none" },
      { kind: "card", id: injected.card.id },
      injected.state,
      M6_CONTENT,
      turnMapContext(injected.state),
    );
    const innatePlan = buildResolvedActionPlan(
      M6_CONTENT.actions["spirit-beacon"] as NonNullable<(typeof M6_CONTENT.actions)["spirit-beacon"]>,
      injected.state.actors.hero as NonNullable<CombatState["actors"][string]>,
      { kind: "none" },
      { kind: "innate", id: "spirit-beacon" },
      injected.state,
      M6_CONTENT,
      turnMapContext(injected.state),
    );
    // Only the provenance differs; the resolution both sides execute is identical.
    expect(cardPlan?.resolution).toEqual(innatePlan?.resolution);
    expect(cardPlan?.source).not.toEqual(innatePlan?.source);
  });

  it("keeps a movement Card on the shared move resolution", () => {
    const fly = M6_CONTENT.actions.fly as NonNullable<(typeof M6_CONTENT.actions)["fly"]>;
    expect(fly.resolution).toEqual({ kind: "move", movementMode: "fly", step: false, triggersReactions: true });
    expect(M6_CONTENT.cards["card.fly"]?.actionId).toBe("fly");
  });
});
