import { describe, expect, it } from "vitest";
import { M6_COMBAT_DEFINITION, M6_CONTENT } from "../content/load-m6-content";
import { buildResolvedActionPlan } from "./action-plan";
import { createCombat, dispatchCombatCommand } from "./engine";
import { previewAction } from "./queries";
import type { ActorState, CombatContent } from "./types";

function fixture(rear = false, flanking = false, penalty = 0) {
  const opened = createCombat(M6_COMBAT_DEFINITION, 34).state;
  const attacker = { ...opened.actors.hero!, position: { x: 1, y: 1 }, facing: "east" as const };
  const target = { ...opened.actors["goblin-skirmisher"]!, hp: 100, maxHp: 100,
    position: { x: 2, y: 1 }, facing: rear ? "east" as const : "west" as const,
    conditions: penalty ? [{ id: "test-penalty", sourceId: "fixture" }] : [] };
  const ally = { ...attacker, id: "ally", position: { x: 3, y: 1 }, facing: "west" as const, defeated: !flanking };
  const state = { ...opened, actors: { hero: attacker, [target.id]: target, ally },
    turn: { ...opened.turn, activeActorId: attacker.id, initiativeOrder: [attacker.id, target.id, ally.id], activeIndex: 0 } };
  const content: CombatContent = { ...M6_CONTENT, conditions: { ...M6_CONTENT.conditions,
    "test-penalty": { id: "test-penalty", name: "Test", traits: [], statModifiers: [{ selector: { kind: "ac" }, type: "circumstance", value: penalty, label: "Test AC" }] },
  } };
  return { state, attacker, target, content };
}
const source = { kind: "basic", id: "strike" } as const;
const targetRef = { kind: "actor", actorId: "goblin-skirmisher" } as const;

describe("structured tactical feedback", () => {
  it.each([[false, false], [true, false], [false, true], [true, true]])("shares preview and executed provenance: rear %s flanking %s", (rear, flank) => {
    const { state, content } = fixture(rear, flank);
    const before = structuredClone(state);
    const preview = previewAction(state, "hero", source, targetRef, content);
    expect(preview.tactical?.causes).toEqual([...(rear ? ["rear"] : []), ...(flank ? ["flanking"] : [])]);
    expect(preview.tactical?.partnerIds).toEqual(flank ? ["ally"] : []);
    expect(state).toEqual(before);
    const result = dispatchCombatCommand(state, { type: "use-action", actorId: "hero", id: "test", sequence: state.sequence + 1, action: source, target: targetRef }, content);
    expect(result.accepted).toBe(true);
    const check = result.events.find((event) => event.type === "CHECK_ROLLED");
    expect(check?.type === "CHECK_ROLLED" ? check.tactical : null).toEqual(preview.tactical);
    expect(check?.type === "CHECK_ROLLED" ? check.dc : null).toBe(preview.check?.dc);
  });

  it.each([-1, -2, -4, 2])("reports actual AC with an existing circumstance contribution %s", (penalty) => {
    const { state, content } = fixture(true, true, penalty);
    const preview = previewAction(state, "hero", source, targetRef, content);
    expect(preview.tactical?.acBeforeOffGuard).toBe(16 + penalty);
    expect(preview.tactical?.ac).toBe(16 + (penalty < 0 ? Math.min(penalty, -2) : penalty - 2));
  });

  it("returns all partners in stable order and removes ineligible partners", () => {
    const { state, attacker, content } = fixture(false, true);
    const far = { ...state.actors.ally, id: "a-far", position: { x: 4, y: 1 } };
    const actors = { ...state.actors, [far.id]: far };
    const get = (entries: Record<string, ActorState>) => previewAction({ ...state, actors: entries }, attacker.id, source, targetRef, content).tactical;
    expect(get(actors)?.partnerIds).toEqual(["a-far", "ally"]);
    expect(get(Object.fromEntries(Object.entries(actors).reverse()))).toEqual(get(actors));
    expect(get({ ...actors, ally: { ...actors.ally, defeated: true }, "a-far": { ...far, facing: "east" } })?.causes).toEqual([]);
  });

  it("does not leak a relationship to a third attacker or an illegal rear-facing target", () => {
    const { state, attacker, content } = fixture(true, true);
    const third = { ...attacker, id: "third", position: { x: 2, y: 0 }, facing: "south" as const };
    const plan = buildResolvedActionPlan(content.actions.strike!, third, targetRef, source, state, content, { kind: "off-turn" });
    expect(plan?.resolution.kind === "strike" ? plan.resolution.tactical.causes : null).toEqual([]);
    const preview = previewAction({ ...state, actors: { ...state.actors, hero: { ...attacker, facing: "west" } } }, "hero", source, targetRef, content);
    expect(preview.reason).toContain("facing arc");
    expect(preview.tactical).toBeUndefined();
    expect(preview.hitChance).toBeUndefined();
  });
});
