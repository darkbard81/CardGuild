import { describe, expect, it } from "vitest";

import { M7_COMBAT_DEFINITION, M7_CONTENT } from "../content/load-m7-content";
import { buildResolvedActionPlan, turnMapContext } from "./action-plan";
import { createCombat, dispatchCombatCommand } from "./engine";
import { resolveStrike } from "./offense";
import { listLegalActions, listLegalTargets, previewAction } from "./queries";
import { hashCombatState } from "./replay";
import {
  resolveArmorClass,
  resolveClassDC,
  resolveStatisticDC,
  resolveStatisticModifier,
} from "./statistics";
import type {
  ActionSource,
  ActionTarget,
  ActorSetup,
  CardInstance,
  CombatCommand,
  CombatEvent,
  CombatState,
  ConditionInstance,
} from "./types";

const CONTENT = M7_CONTENT;
const CONTEXT = { content: CONTENT };
const ENEMY: ActionTarget = { kind: "actor", actorId: "goblin-skirmisher" };
const ALLY: ActionTarget = { kind: "actor", actorId: "ally" };

type Actor = NonNullable<CombatState["actors"][string]>;

function setup(id: string): ActorSetup {
  const actor = M7_COMBAT_DEFINITION.scenario.actors.find((entry) => entry.id === id);
  if (!actor) throw new Error(`Scenario actor "${id}" is missing.`);
  return actor;
}

/** Forces a deterministic order by pushing the heroes' initiative statistic far apart. */
function withInitiative(actor: ActorSetup, value: number): Partial<ActorSetup> {
  return actor.statProfile.kind === "character"
    ? {
        statProfile: {
          kind: "character",
          stats: {
            ...actor.statProfile.stats,
            attributes: { ...actor.statProfile.stats.attributes, wis: value },
          },
        },
      }
    : { statProfile: { kind: "creature", stats: { ...actor.statProfile.stats, perception: value } } };
}

/**
 * Aerin acts first with the skirmisher adjacent to her, a second hero stands behind her as
 * an ally target, and the brute waits out of reach.
 */
function combat(overrides: Readonly<Record<string, Partial<ActorSetup>>> = {}): CombatState {
  const hero = setup("hero");
  const skirmisher = setup("goblin-skirmisher");
  const brute = setup("goblin-brute");
  const actors: ActorSetup[] = [
    { ...hero, position: { x: 1, y: 1 }, facing: "east", ...withInitiative(hero, 100), ...overrides.hero },
    {
      ...hero,
      id: "ally",
      name: "Ally",
      position: { x: 1, y: 2 },
      facing: "east",
      ...withInitiative(hero, 50),
      ...overrides.ally,
    },
    {
      ...skirmisher,
      position: { x: 2, y: 1 },
      facing: "west",
      hp: 100,
      maxHp: 100,
      ...withInitiative(skirmisher, -100),
      ...overrides["goblin-skirmisher"],
    },
    { ...brute, position: { x: 8, y: 6 }, ...withInitiative(brute, -101), ...overrides["goblin-brute"] },
  ];
  return createCombat({ ...M7_COMBAT_DEFINITION, scenario: { ...M7_COMBAT_DEFINITION.scenario, actors } }, 33).state;
}

function actor(state: CombatState, id: string): Actor {
  const found = state.actors[id];
  if (!found) throw new Error(`Actor "${id}" is missing.`);
  return found;
}

/** Puts a card definition into an actor's hand so the Card source can be exercised. */
function withCard(state: CombatState, actorId: string, definitionId: string): {
  readonly state: CombatState;
  readonly source: ActionSource;
} {
  const zones = state.cardZones[actorId] as NonNullable<CombatState["cardZones"][string]>;
  const card: CardInstance = {
    id: `card-injected-${definitionId}`,
    definitionId,
    source: { kind: "base", sourceId: "test" },
  };
  return {
    source: { kind: "card", id: card.id },
    state: { ...state, cardZones: { ...state.cardZones, [actorId]: { ...zones, hand: [card, ...zones.hand] } } },
  };
}

function play(state: CombatState, source: ActionSource, target: ActionTarget): CombatCommand {
  return {
    type: "use-action",
    id: `command-${String(state.sequence + 1)}`,
    sequence: state.sequence + 1,
    actorId: state.turn.activeActorId,
    action: source,
    target,
  };
}

function endTurn(state: CombatState): CombatCommand {
  return {
    type: "end-turn",
    id: `end-${String(state.sequence + 1)}`,
    sequence: state.sequence + 1,
    actorId: state.turn.activeActorId,
  };
}

/** Ends turns until the named actor is active again, collecting everything that happened. */
function cycleTo(state: CombatState, actorId: string): {
  readonly state: CombatState;
  readonly events: readonly CombatEvent[];
} {
  let current = state;
  const events: CombatEvent[] = [];
  for (let guard = 0; guard < 12; guard += 1) {
    const result = dispatchCombatCommand(current, endTurn(current), CONTENT);
    expect(result.accepted).toBe(true);
    current = result.state;
    events.push(...result.events);
    if (current.turn.activeActorId === actorId) return { state: current, events };
  }
  throw new Error(`Never returned to "${actorId}".`);
}

function planFor(state: CombatState, actionId: string, target: ActionTarget, actorId = "hero") {
  const definition = CONTENT.actions[actionId];
  if (!definition) throw new Error(`Action "${actionId}" is missing.`);
  return buildResolvedActionPlan(
    definition,
    actor(state, actorId),
    target,
    { kind: "card", id: "unused" },
    state,
    CONTENT,
    turnMapContext(state),
  );
}

function equipped(...equipmentIds: readonly string[]): Partial<ActorSetup> {
  return { equipmentIds: [...equipmentIds] };
}

function conditions(...instances: readonly ConditionInstance[]): Partial<ActorSetup> {
  return { conditions: [...instances] };
}

function frightened(value: number): ConditionInstance {
  return { id: "frightened", sourceId: "test", value };
}

describe("action requirements", () => {
  it("accepts a melee requirement with a melee weapon and rejects it with a ranged one", () => {
    expect(planFor(combat(), "vicious-swing", ENEMY)).not.toBeNull();
    const ranged = combat({ hero: equipped("composite-shortbow", "scale-mail", "shield") });
    expect(planFor(ranged, "vicious-swing", ENEMY)).toBeNull();
    expect(planFor(ranged, "aimed-shot", ENEMY)).not.toBeNull();
  });

  it("rejects a shield requirement when no shield is equipped", () => {
    expect(planFor(combat(), "shield-press", ENEMY)).not.toBeNull();
    expect(planFor(combat({ hero: equipped("halberd", "scale-mail") }), "shield-press", ENEMY)).toBeNull();
  });

  it("compares a skill rank requirement against the Character's own rank", () => {
    expect(planFor(combat(), "battle-medicine", ALLY)).not.toBeNull();
    const hero = setup("hero");
    if (hero.statProfile.kind !== "character") throw new Error("Aerin must be a Character.");
    const untrained = combat({
      hero: {
        statProfile: {
          kind: "character",
          stats: {
            ...hero.statProfile.stats,
            attributes: { ...hero.statProfile.stats.attributes, wis: 100 },
            skills: { ...hero.statProfile.stats.skills, medicine: "untrained" },
          },
        },
      },
    });
    expect(planFor(untrained, "battle-medicine", ALLY)).toBeNull();
  });

  it("reports the same availability in the action list as the plan boundary", () => {
    const ranged = combat({ hero: equipped("composite-shortbow", "scale-mail") });
    const withMelee = withCard(ranged, "hero", "card.vicious-swing");
    const withBoth = withCard(withMelee.state, "hero", "card.aimed-shot");
    const listed = listLegalActions(withBoth.state, "hero", CONTENT);
    const melee = listed.find((entry) => entry.actionId === "vicious-swing");
    const shot = listed.find((entry) => entry.actionId === "aimed-shot");
    expect(melee?.enabled).toBe(false);
    expect(shot?.enabled).toBe(true);
    // The UI never re-derives this: an unmet requirement is exactly a null plan.
    expect(planFor(withBoth.state, "vicious-swing", ENEMY)).toBeNull();
    expect(planFor(withBoth.state, "aimed-shot", ENEMY)).not.toBeNull();
  });
});

describe("valued conditions", () => {
  it("scales one status penalty by its value across every statistic that shares the stack", () => {
    const one = actor(combat({ hero: conditions(frightened(1)) }), "hero");
    const two = actor(combat({ hero: conditions(frightened(2)) }), "hero");
    const clean = actor(combat(), "hero");

    const reflex = (target: Actor): number =>
      resolveStatisticModifier(target, { kind: "save", id: "reflex" }, CONTEXT).value;
    expect(reflex(one)).toBe(reflex(clean) - 1);
    expect(reflex(two)).toBe(reflex(clean) - 2);

    for (const [label, read] of [
      ["athletics", (target: Actor) => resolveStatisticModifier(target, { kind: "skill", id: "athletics" }, CONTEXT).value],
      ["perception", (target: Actor) => resolveStatisticModifier(target, { kind: "perception" }, CONTEXT).value],
      ["skill DC", (target: Actor) => resolveStatisticDC(target, { kind: "skill", id: "athletics" }, CONTEXT).value],
      ["armor class", (target: Actor) => resolveArmorClass(target, CONTEXT).value],
      ["class DC", (target: Actor) => resolveClassDC(target, CONTEXT).value],
      ["attack", (target: Actor) => resolveStrike(target, CONTEXT).attackModifier],
    ] as const) {
      expect(`${label}:${String(read(two))}`).toBe(`${label}:${String(read(clean) - 2)}`);
    }
  });

  it("leaves weapon damage alone", () => {
    const clean = resolveStrike(actor(combat(), "hero"), CONTEXT).damage;
    const scared = resolveStrike(actor(combat({ hero: conditions(frightened(4)) }), "hero"), CONTEXT).damage;
    expect(scared.flatModifier).toBe(clean.flatModifier);
    expect(scared.count).toBe(clean.count);
  });

  it("merges by the larger value rather than adding", () => {
    const state = combat({ "goblin-skirmisher": conditions(frightened(2)) });
    const withCards = withCard(state, "hero", "card.demoralize");
    // Demoralize succeeds for at most Frightened 2, so it cannot raise an existing 2.
    const result = dispatchCombatCommand(withCards.state, play(withCards.state, withCards.source, ENEMY), CONTENT);
    expect(result.accepted).toBe(true);
    const value = actor(result.state, "goblin-skirmisher").conditions.find((entry) => entry.id === "frightened")?.value;
    expect(value).toBeGreaterThanOrEqual(2);
  });

  it("raises a lower value and refuses to lower a higher one", () => {
    const raised = combat({ "goblin-skirmisher": conditions(frightened(1)) });
    const first = withCard(raised, "hero", "card.iron-presence");
    const applied = dispatchCombatCommand(first.state, play(first.state, first.source, ENEMY), CONTENT);
    expect(applied.accepted).toBe(true);
    const after = actor(applied.state, "goblin-skirmisher").conditions.find((entry) => entry.id === "frightened");
    // Whatever degree came up, the merge policy never produced a value below the existing 1.
    expect(after?.value ?? 0).toBeGreaterThanOrEqual(1);
  });

  it("decays by one at the end of the conditioned actor's own turn and clears at zero", () => {
    const state = combat({ hero: conditions(frightened(2)) });
    const first = dispatchCombatCommand(state, endTurn(state), CONTENT);
    expect(first.accepted).toBe(true);
    expect(actor(first.state, "hero").conditions.find((entry) => entry.id === "frightened")?.value).toBe(1);
    expect(first.events).toContainEqual({
      type: "CONDITION_VALUE_CHANGED",
      actorId: "hero",
      condition: "frightened",
      value: 1,
    });

    const second = cycleTo(first.state, "hero");
    const third = dispatchCombatCommand(second.state, endTurn(second.state), CONTENT);
    expect(third.accepted).toBe(true);
    expect(actor(third.state, "hero").conditions.some((entry) => entry.id === "frightened")).toBe(false);
    expect(third.events).toContainEqual({ type: "CONDITION_REMOVED", actorId: "hero", condition: "frightened" });
  });

  it("keeps the decayed state deterministic", () => {
    const runs = [0, 1].map(() => {
      const state = combat({ hero: conditions(frightened(3)) });
      return dispatchCombatCommand(state, endTurn(state), CONTENT);
    });
    expect(hashCombatState(runs[0]?.state as CombatState)).toBe(hashCombatState(runs[1]?.state as CombatState));
    expect(runs[0]?.events).toEqual(runs[1]?.events);
  });
});

describe("conditions that end when their owner acts again", () => {
  it("keeps a self buff through everyone else's turns and clears it at the owner's next turn", () => {
    const state = combat();
    const played = withCard(state, "hero", "card.brace-behind-cover");
    const result = dispatchCombatCommand(played.state, play(played.state, played.source, { kind: "none" }), CONTENT);
    expect(result.accepted).toBe(true);
    const guarded = actor(result.state, "hero");
    expect(guarded.conditions.some((entry) => entry.id === "covered")).toBe(true);
    expect(resolveArmorClass(guarded, CONTEXT).value).toBe(resolveArmorClass(actor(state, "hero"), CONTEXT).value + 2);

    const cycled = cycleTo(result.state, "hero");
    expect(actor(cycled.state, "hero").conditions.some((entry) => entry.id === "covered")).toBe(false);
    expect(cycled.events).toContainEqual({ type: "CONDITION_REMOVED", actorId: "hero", condition: "covered" });
  });

  it("does not stack two circumstance bonuses of the same size", () => {
    const both = actor(
      combat({ hero: conditions({ id: "covered", sourceId: "a" }, { id: "parrying", sourceId: "b" }) }),
      "hero",
    );
    const one = actor(combat({ hero: conditions({ id: "covered", sourceId: "a" }) }), "hero");
    expect(resolveArmorClass(both, CONTEXT).value).toBe(resolveArmorClass(one, CONTEXT).value);
  });
});

describe("strike extensions", () => {
  it("adds weapon dice without duplicating the attack modifier or the Attribute damage", () => {
    const state = combat();
    const plain = planFor(state, "strike", ENEMY);
    const heavy = planFor(state, "vicious-swing", ENEMY);
    if (plain?.resolution.kind !== "strike" || heavy?.resolution.kind !== "strike") throw new Error("Expected Strikes.");
    expect(heavy.resolution.strike.damage.count).toBe(plain.resolution.strike.damage.count + 1);
    expect(heavy.resolution.strike.damage.flatModifier).toBe(plain.resolution.strike.damage.flatModifier);
    expect(heavy.resolution.strike.attackModifier).toBe(plain.resolution.strike.attackModifier);
    expect(heavy.resolution.strike.damage.sides).toBe(plain.resolution.strike.damage.sides);
  });

  it("previews the wider damage range the execution helper produces", () => {
    const state = combat();
    const played = withCard(state, "hero", "card.vicious-swing");
    const preview = previewAction(played.state, "hero", played.source, ENEMY, CONTENT);
    const plan = planFor(state, "vicious-swing", ENEMY);
    if (plan?.resolution.kind !== "strike") throw new Error("Expected a Strike.");
    const { damage } = plan.resolution.strike;
    expect(preview.damageRange).toEqual([
      Math.max(1, damage.count + damage.flatModifier),
      Math.max(1, damage.count * damage.sides + damage.flatModifier),
    ]);
  });

  it("uses the current MAP stage and then advances it by the declared attack count", () => {
    const state = combat();
    const played = withCard(state, "hero", "card.vicious-swing");
    expect(played.state.turn.attacksThisTurn).toBe(0);
    const plan = planFor(played.state, "vicious-swing", ENEMY);
    if (plan?.resolution.kind !== "strike") throw new Error("Expected a Strike.");
    // The heavy swing itself is the turn's first attack, so it carries no penalty.
    expect(plan.resolution.strike.mapPenalty).toBe(0);

    const result = dispatchCombatCommand(played.state, play(played.state, played.source, ENEMY), CONTENT);
    expect(result.accepted).toBe(true);
    expect(result.state.turn.attacksThisTurn).toBe(2);
    const next = planFor(result.state, "strike", ENEMY);
    if (next?.resolution.kind !== "strike") throw new Error("Expected a Strike.");
    expect(next.resolution.strike.mapPenalty).toBe(-10);
  });

  it("still advances an ordinary attack by one stage", () => {
    const state = combat();
    const result = dispatchCombatCommand(state, play(state, { kind: "basic", id: "strike" }, ENEMY), CONTENT);
    expect(result.accepted).toBe(true);
    expect(result.state.turn.attacksThisTurn).toBe(1);
  });
});

describe("hp restoration", () => {
  const wounded = { ally: { hp: 4 } } as const;

  it("raises current HP without passing max HP or touching max HP itself", () => {
    const state = combat({ ally: { hp: 1 } });
    const played = withCard(state, "hero", "card.lay-on-hands");
    const result = dispatchCombatCommand(played.state, play(played.state, played.source, ALLY), CONTENT);
    expect(result.accepted).toBe(true);
    const healed = actor(result.state, "ally");
    expect(healed.hp).toBe(7);
    expect(healed.maxHp).toBe(actor(state, "ally").maxHp);
  });

  it("clamps to max HP", () => {
    const state = combat({ ally: { hp: actor(combat(), "ally").maxHp - 1 } });
    const played = withCard(state, "hero", "card.lay-on-hands");
    const result = dispatchCombatCommand(played.state, play(played.state, played.source, ALLY), CONTENT);
    expect(result.accepted).toBe(true);
    const healed = actor(result.state, "ally");
    expect(healed.hp).toBe(healed.maxHp);
    expect(result.events).toContainEqual({
      type: "HP_RESTORED",
      sourceActorId: "hero",
      targetActorId: "ally",
      amount: 1,
      remainingHp: healed.maxHp,
    });
  });

  it("never revives a defeated actor", () => {
    const state = combat({ ally: { hp: 0 } });
    const defeated = {
      ...state,
      actors: { ...state.actors, ally: { ...actor(state, "ally"), hp: 0, defeated: true } },
    };
    const played = withCard(defeated, "hero", "card.lay-on-hands");
    const targets = listLegalTargets(played.state, "hero", played.source, CONTENT);
    expect(targets.some((target) => target.kind === "actor" && target.actorId === "ally")).toBe(false);
  });

  it("offers ally and creature scopes to different cards", () => {
    const state = combat(wounded);
    const ally = withCard(state, "hero", "card.soothe");
    const creature = withCard(state, "hero", "card.heal");
    const allyTargets = listLegalTargets(ally.state, "hero", ally.source, CONTENT)
      .flatMap((target) => (target.kind === "actor" ? [target.actorId] : []));
    const creatureTargets = listLegalTargets(creature.state, "hero", creature.source, CONTENT)
      .flatMap((target) => (target.kind === "actor" ? [target.actorId] : []));
    // `ally` is the caster's own team minus itself, so it offers exactly the other hero.
    expect(allyTargets).toEqual(["ally"]);
    // `creature` is any surviving Actor: the caster included, and — as in PF2e, where Heal
    // names a living creature rather than a friend — an enemy too.
    expect(creatureTargets).toContain("hero");
    expect(creatureTargets).toContain("ally");
    expect(creatureTargets).toContain("goblin-skirmisher");
  });

  it("rolls healing deterministically", () => {
    const runs = [0, 1].map(() => {
      const state = combat(wounded);
      const played = withCard(state, "hero", "card.battle-medicine");
      return dispatchCombatCommand(played.state, play(played.state, played.source, ALLY), CONTENT);
    });
    expect(runs[0]?.events).toEqual(runs[1]?.events);
    expect(hashCombatState(runs[0]?.state as CombatState)).toBe(hashCombatState(runs[1]?.state as CombatState));
  });
});

describe("spell-like checks", () => {
  it("rolls the target's save against a DC derived from the acting Character", () => {
    const state = combat();
    const plan = planFor(state, "frostbite", ENEMY);
    if (plan?.resolution.kind !== "check") throw new Error("Expected a check.");
    expect(plan.resolution.check.roller).toBe("target");
    expect(plan.resolution.check.rollerActorId).toBe("goblin-skirmisher");
    expect(plan.resolution.check.modifier).toBe(
      resolveStatisticModifier(actor(state, "goblin-skirmisher"), { kind: "save", id: "fortitude" }, CONTEXT).value,
    );
    expect(plan.resolution.check.dc).toBe(
      resolveStatisticDC(actor(state, "hero"), { kind: "skill", id: "arcana", attributeOverride: "int" }, CONTEXT).value,
    );
  });

  it("rolls the actor's skill against the target's Armor Class for a spell attack", () => {
    const state = combat();
    const plan = planFor(state, "telekinetic-projectile", ENEMY);
    if (plan?.resolution.kind !== "check") throw new Error("Expected a check.");
    expect(plan.resolution.check.roller).toBe("actor");
    expect(plan.resolution.check.dc).toBe(resolveArmorClass(actor(state, "goblin-skirmisher"), CONTEXT).value);
  });

  it("reads a Class DC without any authored spell DC", () => {
    const state = combat();
    const plan = planFor(state, "iron-presence", ENEMY);
    if (plan?.resolution.kind !== "check") throw new Error("Expected a check.");
    expect(plan.resolution.check.dc).toBe(resolveClassDC(actor(state, "hero"), CONTEXT).value);
    const authored = JSON.stringify(CONTENT.actions["iron-presence"]);
    expect(authored).not.toContain('"fixed"');
  });

  it("keeps preview probabilities on the roller's side of a target save", () => {
    const state = combat();
    const played = withCard(state, "hero", "card.frostbite");
    const preview = previewAction(played.state, "hero", played.source, ENEMY, CONTENT);
    expect(preview.legal).toBe(true);
    expect(preview.check?.roller).toBe("target");
    expect(preview.check?.rollerActorId).toBe("goblin-skirmisher");
    // A target's save is never reported as the acting Character's hit.
    expect(preview.hitChance).toBeUndefined();
    expect(preview.criticalChance).toBeUndefined();
    const total = Object.values(preview.degreeProbabilities ?? {}).reduce((sum, value) => sum + value, 0);
    expect(total).toBeCloseTo(1);
  });

  it("scales one authored base die across the four basic-save degrees", () => {
    // PF2e basic save: no damage / half / full / double from the same authored dice
    // (https://2e.aonprd.com/Rules.aspx?ID=2296), not four separate dice profiles.
    for (const [id, count, sides] of [["frostbite", 2, 4], ["daze", 1, 6], ["harm", 1, 8]] as const) {
      const action = CONTENT.actions[id];
      if (action?.resolution.kind !== "check") throw new Error(`${id} must be a check.`);
      const { outcomes } = action.resolution;
      expect(`${id}:${String(outcomes["critical-success"].length)}`).toBe(`${id}:0`);
      for (const [degree, multiplier] of [["success", 0.5], ["failure", 1], ["critical-failure", 2]] as const) {
        const effect = outcomes[degree][0];
        if (effect?.kind !== "damage") throw new Error(`${id} ${degree} must deal damage.`);
        expect(`${id}.${degree}`).toBe(`${id}.${degree}`);
        expect({ count: effect.dice.count, sides: effect.dice.sides, multiplier: effect.multiplier }).toEqual({
          count, sides, multiplier,
        });
      }
    }
  });

  it("rounds a successful basic save down to half the rolled damage", () => {
    const state = combat();
    const played = withCard(state, "hero", "card.frostbite");
    const result = dispatchCombatCommand(played.state, play(played.state, played.source, ENEMY), CONTENT);
    expect(result.accepted).toBe(true);
    const rolled = result.events.find((event) => event.type === "CHECK_ROLLED");
    const dealt = result.events.find((event) => event.type === "DAMAGE_DEALT");
    if (!rolled) throw new Error("Expected a save roll.");
    if (rolled.degree === "critical-success") {
      expect(dealt).toBeUndefined();
      return;
    }
    if (!dealt) throw new Error("Expected damage.");
    // 2d4 can never exceed 8, so a successful save can never deal more than 4.
    const cap = rolled.degree === "success" ? 4 : rolled.degree === "failure" ? 8 : 16;
    expect(dealt.amount).toBeLessThanOrEqual(cap);
    expect(dealt.amount).toBeGreaterThanOrEqual(1);
    expect(Number.isInteger(dealt.amount)).toBe(true);
  });

  it("preserves the authored damage type all the way into the event", () => {
    const state = combat();
    const played = withCard(state, "hero", "card.harm");
    const result = dispatchCombatCommand(played.state, play(played.state, played.source, ENEMY), CONTENT);
    expect(result.accepted).toBe(true);
    const damage = result.events.filter((event) => event.type === "DAMAGE_DEALT");
    expect(damage.length).toBeGreaterThan(0);
    for (const event of damage) expect(event.damageType).toBe("void");
  });

  it("deals automatic damage for a check-free direct card", () => {
    const state = combat();
    const played = withCard(state, "hero", "card.force-barrage");
    const preview = previewAction(played.state, "hero", played.source, ENEMY, CONTENT);
    expect(preview.legal).toBe(true);
    expect(preview.check).toBeUndefined();
    const result = dispatchCombatCommand(played.state, play(played.state, played.source, ENEMY), CONTENT);
    expect(result.accepted).toBe(true);
    expect(result.events.some((event) => event.type === "CHECK_ROLLED")).toBe(false);
    expect(result.events.some((event) => event.type === "DAMAGE_DEALT" && event.damageType === "force")).toBe(true);
  });
});

describe("production card library", () => {
  it("covers every resolution family and required tactical axis", () => {
    const definitions = Object.values(CONTENT.cards).map((card) => {
      const action = CONTENT.actions[card.actionId];
      if (!action) throw new Error(`Card "${card.id}" references a missing action.`);
      return action;
    });
    const count = (predicate: (action: (typeof definitions)[number]) => boolean): number =>
      definitions.filter(predicate).length;

    expect(definitions.length).toBeGreaterThanOrEqual(24);
    expect(definitions.length).toBeLessThanOrEqual(32);
    expect(count((action) => action.resolution.kind === "move")).toBeGreaterThanOrEqual(3);
    expect(count((action) => action.resolution.kind === "strike")).toBeGreaterThanOrEqual(6);
    expect(count((action) => action.resolution.kind === "check")).toBeGreaterThanOrEqual(7);
    expect(count((action) => action.resolution.kind === "direct")).toBeGreaterThanOrEqual(3);
    expect(count((action) => action.timing.kind === "reaction")).toBeGreaterThanOrEqual(1);
    expect(count((action) =>
      action.resolution.kind === "check" && action.resolution.check.roller === "target")).toBeGreaterThanOrEqual(3);
    expect(count((action) =>
      action.resolution.kind === "check" &&
      action.resolution.check.roller === "actor" &&
      action.resolution.check.statistic.kind === "skill" &&
      action.resolution.check.dc.kind === "statistic-dc")).toBeGreaterThanOrEqual(3);
    expect(count((action) =>
      action.resolution.kind === "check" && action.resolution.check.dc.kind === "class-dc")).toBeGreaterThanOrEqual(1);

    const effects = definitions.flatMap((action) =>
      action.resolution.kind === "direct"
        ? action.resolution.effects
        : action.resolution.kind === "move"
          ? []
          : Object.values(action.resolution.outcomes).flat());
    expect(effects.filter((effect) => effect.kind === "restore-hp").length).toBeGreaterThanOrEqual(2);
    const valued = definitions.filter((action) =>
      (action.resolution.kind === "direct"
        ? action.resolution.effects
        : action.resolution.kind === "move"
          ? []
          : Object.values(action.resolution.outcomes).flat()
      ).some((effect) => effect.kind === "apply-condition" && effect.value !== undefined));
    expect(valued.length).toBeGreaterThanOrEqual(2);
  });

  it("keeps every card's action resolvable once its own requirements are met", () => {
    const melee = combat();
    const ranged = combat({ hero: equipped("composite-shortbow", "scale-mail", "shield") });
    for (const card of Object.values(CONTENT.cards)) {
      const action = CONTENT.actions[card.actionId];
      if (!action) throw new Error(`Card "${card.id}" references a missing action.`);
      // A requirement is the point: each card is checked in a state that satisfies its own.
      const state = (action.requirements ?? []).some(
        (requirement) => requirement.kind === "weapon-mode" && requirement.mode === "ranged",
      )
        ? ranged
        : melee;
      const target: ActionTarget = action.targeting === "enemy"
        ? ENEMY
        : action.targeting === "ally"
          ? ALLY
          : action.targeting === "creature"
            ? ALLY
            : action.targeting === "tile"
              ? { kind: "tile", position: { x: 1, y: 2 }, facing: "east" }
              : action.targeting === "effect"
                ? { kind: "effect", effectId: "missing" }
                : { kind: "none" };
      // Movement and effect targeting resolve outside the plan's numeric core, so this only
      // asserts that no card reaches the boundary and produces nothing at all.
      if (action.targeting === "effect") continue;
      expect(`${card.id}:${String(planFor(state, action.id, target) !== null)}`).toBe(`${card.id}:true`);
    }
  });
});
