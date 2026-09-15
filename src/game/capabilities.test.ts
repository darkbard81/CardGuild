import { describe, expect, it } from "vitest";
import { createCoreContentSource, createCoreRulesFixture, createTacticalCombatFixture } from "../../tests/fixtures/content";
import { ContentCompilationError, compileContentPack } from "../content/compile-content";
import { validateContentPackSemantics } from "../content/validate-semantics";
import { PRODUCTION_CONTENT } from "../content/production-content";
import { deriveTacticalDeck, validatePartyLoadout } from "../loadout/loadout";
import { buildResolvedActionPlan, turnMapContext } from "./action-plan";
import { isCardEligible, isRingAction, matchesEligibilityGroups, resolveEffectiveActionTraits } from "./capabilities";
import { createCombat, dispatchCombatCommand } from "./engine";
import { listLegalActions, previewAction, resolveActionSource } from "./queries";
import { createCombatReplay, hashCombatState, replayCombat } from "./replay";
import type { ActionDefinition, ActionSource, CombatCommand, CombatState, TraitInstance } from "./types";

const traits = (...ids: string[]): TraitInstance[] => ids.map(id => ({ id }));
const fixture = createTacticalCombatFixture();
const target = { kind: "actor" as const, actorId: "goblin-skirmisher" };
function arena() {
  const opened = createCombat(fixture, 1).state;
  return { ...opened, actors: { ...opened.actors,
    hero: { ...opened.actors.hero!, position: { x: 1, y: 1 }, facing: "east" as const },
    "goblin-skirmisher": { ...opened.actors["goblin-skirmisher"]!, position: { x: 2, y: 1 }, hp: 200, maxHp: 200 },
  }, turn: { ...opened.turn, activeActorId: "hero", activeIndex: opened.turn.initiativeOrder.indexOf("hero"), attacksThisTurn: 1 } };
}
function putCard(state: CombatState, definitionId: string, id = "test-card"): CombatState {
  return { ...state, cardZones: { ...state.cardZones, hero: { ...state.cardZones.hero!, hand: [
    { id, definitionId, source: { kind: "prepared", memberId: "hero" } },
  ] } } };
}
function command(state: CombatState, action: ActionSource): CombatCommand {
  return { type: "use-action", actorId: "hero", id: `cap-${state.sequence + 1}`, sequence: state.sequence + 1, action, target };
}

describe("canonical capability eligibility", () => {
  it("uses registry identity with OR within and AND across extensible groups", () => {
    const groups = [{ fighter: {}, barbarian: {} }, { dwarf: {}, elf: {} }];
    const card = traits("fighter", "barbarian", "dwarf", "elf", "flourish", "move");
    for (const ids of [["fighter", "dwarf"], ["barbarian", "elf"], ["wizard", "fighter", "elf"]]) {
      expect(matchesEligibilityGroups(card, traits(...ids), groups)).toBe(true);
    }
    for (const ids of [["fighter", "human"], ["wizard", "dwarf"], []]) {
      expect(matchesEligibilityGroups(card, traits(...ids), groups)).toBe(false);
    }
    expect(matchesEligibilityGroups(traits("move"), [], groups)).toBe(true);
  });

  it.each(["fighter", "barbarian", "wizard"])("shares prepare/use eligibility for %s while ownership is unrestricted", identity => {
    const rules = createCoreRulesFixture();
    const base = rules.actorDefinitions["hero.aerin"]!;
    const classes = { ...rules.combatContent.classes, barbarian: { ...rules.combatContent.classes.fighter!, id: "barbarian" } };
    const card = { ...rules.combatContent.cards["card.trip"]!, traits: traits("fighter", "barbarian", "attack") };
    const combatContent = { ...rules.combatContent, classes, cards: { ...rules.combatContent.cards, [card.id]: card } };
    const actor = { ...base, traits: traits(identity) };
    const content = { ...rules, combatContent, actorDefinitions: { ...rules.actorDefinitions, [actor.id]: actor } };
    const party = { members: { hero: { id: "hero", actorDefinitionId: actor.id, loadout: { equipment: {}, preparedCards: [card.id] } } } };
    const collection = { equipment: {}, cards: { [card.id]: 1 } };
    expect(validatePartyLoadout(party, collection, content).valid).toBe(identity !== "wizard");
    expect(validatePartyLoadout({ members: { hero: { ...party.members.hero, loadout: { equipment: {}, preparedCards: [] } } } }, collection, content).valid).toBe(true);
    const initial = arena();
    const state = putCard({ ...initial, actors: { ...initial.actors, hero: { ...initial.actors.hero!, traits: traits(identity) } } }, card.id);
    const source = { kind: "card" as const, id: "test-card" };
    expect(resolveActionSource(state, state.actors.hero!, source, combatContent) !== null).toBe(identity !== "wizard");
    expect(dispatchCombatCommand(state, command(state, source), combatContent).accepted).toBe(identity !== "wizard");
    expect(isCardEligible(initial.actors["goblin-skirmisher"]!, card, combatContent)).toBe(true);
  });

  it("does not restrict an untagged Card and never derives eligibility from category", () => {
    const content = { ...fixture.content, traits: { ...fixture.content.traits, fighter: { ...fixture.content.traits.fighter!, category: "general" as const } } };
    const wizard = { ...arena().actors.hero!, traits: traits("wizard") };
    expect(isCardEligible(wizard, { ...content.cards["card.trip"]!, traits: [] }, content)).toBe(true);
    expect(isCardEligible(wizard, { ...content.cards["card.trip"]!, traits: traits("fighter") }, content)).toBe(false);
  });

  it("compiles a multi-class Flourish movement Card without a class allow-list", () => {
    const source = createCoreContentSource();
    const card = { ...source.cards.find(card => card.id === "card.fly")!, traits: traits("fighter", "barbarian", "flourish", "move") };
    const pack = compileContentPack({ ...source,
      traits: [...source.traits, { ...source.traits.find(trait => trait.id === "fighter")!, id: "barbarian", name: "Barbarian" }, PRODUCTION_CONTENT.pack.combatContent.traits.flourish!],
      classes: [...source.classes, { ...source.classes.find(entry => entry.id === "fighter")!, id: "barbarian" }],
      cards: source.cards.map(entry => entry.id === card.id ? card : entry),
    });
    expect(isCardEligible(pack.actorDefinitions["hero.aerin"]!, card, pack.combatContent)).toBe(true);
    expect(isCardEligible({ statProfile: { kind: "character" }, traits: traits("barbarian") }, card, pack.combatContent)).toBe(true);
  });

  it("prevents equipment grants from bypassing deck eligibility", () => {
    const rules = createCoreRulesFixture();
    const base = rules.actorDefinitions["hero.aerin"]!;
    const card = { ...rules.combatContent.cards["card.trip"]!, traits: traits("rogue", "attack") };
    const content = { ...rules, combatContent: { ...rules.combatContent, cards: { ...rules.combatContent.cards, [card.id]: card } } };
    const party = { members: { hero: { id: "hero", actorDefinitionId: base.id, loadout: { equipment: { weapon: "halberd" }, preparedCards: [] } } } };
    expect(validatePartyLoadout(party, { equipment: { halberd: 1 }, cards: {} }, content).issues.map(issue => issue.code)).toContain("INELIGIBLE_CARD");

  });

  it("refuses missing primitive traits and unresolved Class authoring", () => {
    const source = createCoreContentSource();
    for (const id of ["card.fly", "card.reactive-strike"]) {
      const invalid = { ...source, cards: source.cards.map(card => card.id === id ? { ...card, traits: [] } : card) };
      expect(validateContentPackSemantics(invalid).map(issue => issue.code)).toContain("MISSING_CAPABILITY_TRAIT");
    }
    const invalid = { ...source, traits: [...source.traits, { ...source.traits.find(trait => trait.id === "fighter")!, id: "missing-class" }],
      cards: source.cards.map(card => card.id === "card.trip" ? { ...card, traits: traits("missing-class") } : card),
    };
    expect(validateContentPackSemantics(invalid).map(issue => issue.code)).toContain("UNKNOWN_CLASS");
  });

  it("rejects authored Character innate bypasses and ineligible base/prepared grants", () => {
    const source = createCoreContentSource();
    expect(() => compileContentPack({ ...source, actors: source.actors.map(actor => actor.statProfile.kind === "character" ? { ...actor, innateActionIds: ["trip"] } : actor) })).toThrow(ContentCompilationError);
    expect(validateContentPackSemantics({ ...source, actors: source.actors.map(actor => actor.statProfile.kind === "character" ? { ...actor, innateActionIds: ["trip"] } : actor) }).map(issue => issue.code)).toContain("CHARACTER_INNATE_FORBIDDEN");
    expect(() => compileContentPack(source)).not.toThrow();
    const card = { ...source.cards[0]!, traits: traits("rogue") };
    for (const location of ["prepared", "base"]) {
      const changed = { ...source, cards: source.cards.map(entry => entry.id === card.id ? card : entry), actors: source.actors.map(actor => actor.statProfile.kind !== "character" ? actor : {
        ...actor,
        ...(location === "prepared" ? { starterLoadout: { ...actor.starterLoadout, preparedCards: [card.id] } }
          : { baseCardGrants: [{ cardDefinitionId: card.id, count: 1, sourceId: "test" }] }),
      }) };
      expect(() => compileContentPack(changed)).toThrow(ContentCompilationError);
      expect(validateContentPackSemantics(changed).map(issue => issue.code)).toContain("INELIGIBLE_CARD");
    }
    const state = arena();
    const actor = { ...state.actors.hero!, innateActionIds: ["trip"] };
    expect(resolveActionSource(state, actor, { kind: "innate", id: "trip" }, fixture.content)).toBeNull();
  });
});

describe("effective Attack traits", () => {
  it.each([true, false])("Card attack=%s overrides the shared Action in preview, execution and MAP", attack => {
    const content = { ...fixture.content, cards: { ...fixture.content.cards, "card.trip": { ...fixture.content.cards["card.trip"]!, traits: attack ? traits("attack") : [] } } };
    const state = putCard(arena(), "card.trip");
    const source = { kind: "card" as const, id: "test-card" };
    const plan = buildResolvedActionPlan(content.actions.trip!, state.actors.hero!, target, source, state, content, turnMapContext(state));
    expect(plan?.resolution.kind).toBe("check");
    const preview = previewAction(state, "hero", source, target, content);
    expect(preview.legal).toBe(true);
    const result = dispatchCombatCommand(state, command(state, source), content);
    expect(result.accepted).toBe(true);
    expect(result.state.turn.attacksThisTurn).toBe(attack ? 2 : 1);
    const check = result.events.find(event => event.type === "CHECK_ROLLED");
    if (plan?.resolution.kind !== "check" || check?.type !== "CHECK_ROLLED") throw new Error("Missing check");
    expect(check.modifier).toBe(plan.resolution.check.modifier);
    const firstAttackPlan = buildResolvedActionPlan(content.actions.trip!, state.actors.hero!, target, source, state, content, { kind: "turn", attacksThisTurn: 0 });
    if (firstAttackPlan?.resolution.kind !== "check") throw new Error("Missing first-attack plan");
    expect(check.modifier - firstAttackPlan.resolution.check.modifier).toBe(attack ? -5 : 0);
    expect(check.modifierSources).toEqual(preview.notes);
    expect(listLegalActions(state, "hero", content).find(action => action.source.id === source.id)?.traits).toEqual(attack ? ["attack"] : []);
    const withoutActionAttack = { ...content, actions: { ...content.actions, trip: { ...content.actions.trip!, traits: [] } } };
    expect(dispatchCombatCommand(state, command(state, source), withoutActionAttack).state.turn.attacksThisTurn).toBe(attack ? 2 : 1);
  });

  it("keeps Basic Strike and Creature innate Knockdown on Action traits", () => {
    const state = arena();
    for (const [source, definition] of [
      [{ kind: "basic", id: "strike" }, fixture.content.actions.strike!],
      [{ kind: "innate", id: "knockdown" }, fixture.content.actions.knockdown!],
    ] as const) expect(resolveEffectiveActionTraits(source, definition, state, fixture.content, "hero")).toContain("attack");
    expect(dispatchCombatCommand(state, command(state, { kind: "basic", id: "strike" }), fixture.content).state.turn.attacksThisTurn).toBe(2);
    const creatureId = "goblin-skirmisher";
    const creature = state.actors[creatureId]!;
    const innateState = { ...state, actors: { ...state.actors, [creatureId]: { ...creature, facing: "west" as const, innateActionIds: ["knockdown"] } },
      turn: { ...state.turn, activeActorId: creatureId, activeIndex: state.turn.initiativeOrder.indexOf(creatureId) },
    };
    const source = { kind: "innate" as const, id: "knockdown" };
    const preview = previewAction(innateState, creatureId, source, { kind: "actor", actorId: "hero" }, fixture.content);
    expect(preview.legal).toBe(true);
    const result = dispatchCombatCommand(innateState, { ...command(innateState, source), actorId: creatureId, target: { kind: "actor", actorId: "hero" } } as CombatCommand, fixture.content);
    expect(result.accepted).toBe(true);
    expect(result.state.turn.attacksThisTurn).toBe(2);
    expect(result.events.find(event => event.type === "CHECK_ROLLED")).toMatchObject({ modifierSources: preview.notes });
  });
});

describe("reaction capability validation", () => {
  it("checks effective Flourish and Class eligibility both before offering and before committing a reaction", () => {
    const card = { ...fixture.content.cards["card.reactive-strike"]!, traits: traits("fighter", "attack", "reaction", "flourish") };
    const content = { ...fixture.content, cards: { ...fixture.content.cards, [card.id]: card } };
    const initial = putCard(arena(), card.id);
    const moverId = "goblin-skirmisher";
    const state: CombatState = { ...initial, actors: { ...initial.actors, hero: { ...initial.actors.hero!, reactionAvailable: true } },
      turn: { ...initial.turn, activeActorId: moverId, activeIndex: initial.turn.initiativeOrder.indexOf(moverId) },
    };
    const move: CombatCommand = { type: "use-action", id: "move-trigger", sequence: state.sequence + 1, actorId: moverId,
      action: { kind: "basic", id: "stride" }, target: { kind: "tile", position: { x: 3, y: 1 } },
    };
    const opened = dispatchCombatCommand(state, move, content);
    expect(opened.accepted).toBe(true);
    expect(opened.state.pendingReaction?.candidates[0]?.actorId).toBe("hero");
    const pending = opened.state.pendingReaction!;
    const reaction: CombatCommand = { type: "use-reaction", id: "react", sequence: opened.state.sequence + 1, actorId: "hero",
      triggerId: pending.triggerId, cardInstanceId: "test-card",
    };
    const accepted = dispatchCombatCommand(opened.state, reaction, content);
    expect(accepted.accepted).toBe(true);
    expect(accepted.state.turn.usedTraitsByActor.hero).toEqual(["flourish"]);
    expect(accepted.state.turn.attacksThisTurn).toBe(state.turn.attacksThisTurn);
    for (const invalid of [
      { ...state, actors: { ...state.actors, hero: { ...state.actors.hero!, traits: traits("wizard") } } },
      { ...state, turn: { ...state.turn, usedTraitsByActor: { hero: ["flourish"] } } },
    ]) {
      expect(dispatchCombatCommand(invalid, move, content).state.pendingReaction).toBeNull();
      const stale = { ...opened.state, actors: invalid.actors, turn: invalid.turn };
      const refused = dispatchCombatCommand(stale, reaction, content);
      expect(refused.accepted).toBe(false);
      expect(refused.state).toBe(stale);
      expect(refused.events).toEqual([]);
    }
  });
});

describe("Flourish once per turn", () => {
  it("shares a Trait restriction across Cards, resets on turn change, and replays exactly", () => {
    const flourish: ActionDefinition = { id: "flourish-test", name: "Flourish", description: "Synthetic rule capability", timing: { kind: "turn", actions: 1 }, traits: [], targeting: "self", range: { kind: "feet", value: 0 }, resolution: { kind: "direct", effects: [] } };
    const cards = ["one", "two", "ordinary"].map(id => ({ id, name: id, actionId: flourish.id, traits: id === "ordinary" ? [] : traits("flourish") }));
    const content = { ...fixture.content, actions: { ...fixture.content.actions, [flourish.id]: flourish }, cards: Object.fromEntries(cards.map(card => [card.id, card])) };
    const definition = { ...fixture, content, scenario: { ...fixture.scenario, actors: fixture.scenario.actors.map(actor => ({ ...actor,
      deckContributions: cards.map(card => ({ cardDefinitionId: card.id, count: 1, source: { kind: "base" as const, sourceId: "test" } })),
    })) } };
    const setup = createCombat(definition, 1);
    let state = setup.state;
    const actorId = state.turn.activeActorId;
    const events = [...setup.events];
    const play = (id: string) => {
      const card = state.cardZones[actorId]!.hand.find(card => card.definitionId === id)!;
      return dispatchCombatCommand(state, { type: "use-action", id: `flourish-${state.sequence + 1}`, sequence: state.sequence + 1, actorId,
        action: { kind: "card", id: card.id }, target: { kind: "none" } }, content);
    };
    for (const id of ["ordinary", "one"]) {
      const result = play(id); expect(result.accepted).toBe(true); state = result.state; events.push(...result.events);
      expect(state.turn.usedTraitsByActor[actorId] ?? []).toEqual(id === "ordinary" ? [] : ["flourish"]);
    }
    const rejected = play("two");
    expect(rejected.accepted).toBe(false); expect(rejected.state).toBe(state); expect(rejected.error).toContain("Flourish");
    const second = state.cardZones[actorId]!.hand.find(card => card.definitionId === "two")!;
    expect(previewAction(state, actorId, { kind: "card", id: second.id }, { kind: "none" }, content).legal).toBe(false);
    expect(listLegalActions(state, actorId, content).find(action => action.source.id === second.id)?.enabled).toBe(false);
    expect(state.turn.usedTraitsByActor).not.toBe(setup.state.turn.usedTraitsByActor);
    do {
      const result = dispatchCombatCommand(state, { type: "end-turn", id: `end-${state.sequence + 1}`, sequence: state.sequence + 1,
        actorId: state.turn.activeActorId, facing: state.actors[state.turn.activeActorId]!.facing }, content);
      expect(result.accepted).toBe(true); state = result.state; events.push(...result.events);
    } while (state.turn.activeActorId !== actorId);
    expect(state.turn.usedTraitsByActor).toEqual({});
    const next = play("two"); expect(next.accepted).toBe(true); state = next.state; events.push(...next.events);
    const replay = replayCombat(definition, createCombatReplay(state));
    expect(hashCombatState(replay.state)).toBe(hashCombatState(state)); expect(replay.events).toEqual(events);
    expect(hashCombatState(JSON.parse(JSON.stringify(state)) as CombatState)).toBe(hashCombatState(state));
  });
});

describe("production capability audit", () => {
  it("authors the complete existing rule vocabulary on every production Card", () => {
    const content = PRODUCTION_CONTENT.pack.combatContent;
    for (const card of Object.values(content.cards)) {
      const actionTraits = content.actions[card.actionId]!.traits.map(trait => trait.id);
      expect(card.traits.map(trait => trait.id), card.id).toEqual(expect.arrayContaining(actionTraits));
    }
    for (const actor of Object.values(PRODUCTION_CONTENT.pack.actorDefinitions)) {
      for (const id of deriveTacticalDeck(actor, actor.starterLoadout, content, actor.id).contributions.map(entry => entry.cardDefinitionId)) {
        expect(isCardEligible(actor, content.cards[id]!, content), `${actor.id}: ${id}`).toBe(true);
      }
    }
  });

  it("keeps Card and innate sources out of the Ring while retaining the full rules query", () => {
    const state = putCard(arena(), "card.trip");
    const actions = listLegalActions(state, "hero", fixture.content);
    expect(actions.some(action => action.source.kind === "card")).toBe(true);
    expect(actions.filter(isRingAction).every(action => ["basic", "context"].includes(action.source.kind))).toBe(true);
    expect(isRingAction({ source: { kind: "innate", id: "knockdown" } })).toBe(false);
  });
});
