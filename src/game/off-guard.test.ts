import { describe, expect, it } from "vitest";
import { createTacticalCombatFixture } from "../../tests/fixtures/content";
import { createCombat } from "./engine";
import { crossesOppositeSides, resolveOffGuardTo } from "./off-guard";
import { resolveArmorClass } from "./statistics";
import type { ActorState } from "./types";

/** The three-Character rules on the Ruined Gate board. */
const CHARACTER_RULES_COMBAT = createTacticalCombatFixture({ rules: "character-rules" });
const CHARACTER_RULES_CONTENT = CHARACTER_RULES_COMBAT.content;

const context = { content: CHARACTER_RULES_CONTENT };
function fixture(rear = false, flank = false) {
  const opened = createCombat(CHARACTER_RULES_COMBAT, 33).state;
  const attacker: ActorState = { ...opened.actors.hero!, position: { x: 1, y: 1 }, facing: "east" };
  const target: ActorState = { ...opened.actors["goblin-skirmisher"]!, position: { x: 2, y: 1 }, facing: rear ? "east" : "west" };
  const ally: ActorState = { ...attacker, id: "ally", position: { x: 3, y: 1 }, facing: "west", defeated: !flank };
  const state = { ...opened, actors: { [attacker.id]: attacker, [target.id]: target, ally } };
  return { state, attacker, target, ally };
}

describe("attacker-relative Off-Guard", () => {
  it.each([
    [false, false, []], [true, false, ["rear"]],
    [false, true, ["flanking"]], [true, true, ["rear", "flanking"]],
  ] as const)("rear %s flanking %s uses typed AC stacking", (rear, flank, causes) => {
    const { state, attacker, target } = fixture(rear, flank);
    const result = resolveOffGuardTo(state, attacker, target, context);
    expect(result.causes).toEqual(causes);
    const ac = resolveArmorClass(target, { ...context, modifiers: result.modifiers });
    expect(ac.value).toBe(resolveArmorClass(target, context).value - (causes.length ? 2 : 0));
    expect(ac.sources.filter((s) => s.sourceId.startsWith("off-guard:") && s.applied)).toHaveLength(causes.length ? 1 : 0);
  });

  it.each([-4, 2])("stacks existing circumstance modifier %s", (value) => {
    const { state, attacker, target } = fixture(true, true);
    const { modifiers } = resolveOffGuardTo(state, attacker, target, context);
    const ac = resolveArmorClass(target, { ...context, modifiers: [...modifiers, {
      selector: { kind: "ac" }, type: "circumstance", value, sourceId: "test", label: "Test",
    }] });
    expect(ac.value).toBe(resolveArmorClass(target, context).value + (value < 0 ? value : value - 2));
  });

  it("excludes ranged attacks and ranged allies even at melee distance", () => {
    const { state, attacker, target, ally } = fixture(true, true);
    const equipment = Object.values(CHARACTER_RULES_CONTENT.equipment).find((item) => item.weaponProfile);
    if (!equipment?.weaponProfile) throw new Error("Missing weapon fixture");
    const rangedContext = { content: { ...CHARACTER_RULES_CONTENT, equipment: { ...CHARACTER_RULES_CONTENT.equipment,
      ranged: { ...equipment, id: "ranged", weaponProfile: { ...equipment.weaponProfile, attackMode: "ranged" as const } },
    } } };
    const ranged = { ...attacker, equipmentIds: ["ranged"] };
    expect(resolveOffGuardTo(state, ranged, target, rangedContext).causes).toEqual([]);
    const rangedAlly = { ...ally, equipmentIds: ["ranged"] };
    expect(resolveOffGuardTo({ ...state, actors: { ...state.actors, ally: rangedAlly } }, attacker, target, rangedContext).causes).toEqual(["rear"]);
  });

  it.each([
    { defeated: true }, { facing: "east" as const }, { team: "enemies" as const },
    { position: { x: 7, y: 1 } }, { position: { x: 2, y: 0 } },
  ])("requires an eligible opposite ally: %j", (override) => {
    const { state, attacker, target, ally } = fixture(false, true);
    expect(resolveOffGuardTo({ ...state, actors: { ...state.actors, ally: { ...ally, ...override } } }, attacker, target, context).offGuard).toBe(false);
  });

  it("supports opposite corners at melee reach and ignores target facing for flanking", () => {
    const { state, attacker, target, ally } = fixture(false, true);
    const diagonalAttacker = { ...attacker, position: { x: 1, y: 0 } };
    const diagonalAlly = { ...ally, position: { x: 3, y: 2 } };
    const actors = { ...state.actors, [attacker.id]: diagonalAttacker, ally: diagonalAlly };
    for (const facing of ["north", "east", "south", "west"] as const) {
      expect(resolveOffGuardTo({ ...state, actors }, diagonalAttacker, { ...target, facing }, context).causes).toEqual(["flanking"]);
    }
  });

  it("does not allow an ally to threaten through a blocked tile", () => {
    const { state, attacker, target, ally } = fixture(false, true);
    const distant = { ...ally, position: { x: 4, y: 1 } };
    const tile = state.map.tiles["3,1"]!;
    const map = { ...state.map, tiles: { ...state.map.tiles, "3,1": { ...tile, traits: [{ id: "blocked" }] } } };
    expect(resolveOffGuardTo({ ...state, map, actors: { ...state.actors, ally: distant } }, attacker, target, context).offGuard).toBe(false);
  });

  it("does not make a third attacker off-guard or mutate conditions", () => {
    const { state, attacker, target } = fixture(true, true);
    const before = structuredClone(state);
    const third = { ...attacker, id: "third", position: { x: 2, y: 0 }, facing: "south" as const };
    expect(resolveOffGuardTo(state, third, target, context).offGuard).toBe(false);
    expect(state).toEqual(before);
  });

  it.each([
    [{ x: -1, y: 0 }, { x: 1, y: 0 }, true],
    [{ x: -1, y: -1 }, { x: 1, y: 1 }, true],
    [{ x: -2, y: 0 }, { x: 2, y: 1 }, false],
    [{ x: -2, y: 0 }, { x: 3, y: 1 }, true],
    [{ x: -1, y: 0 }, { x: 0, y: 1 }, false],
  ])("checks the segment across the square %j %j", (a, b, expected) => {
    expect(crossesOppositeSides(a, b, { x: 0, y: 0 })).toBe(expected);
  });
});
