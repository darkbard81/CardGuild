import { describe, expect, it } from "vitest";
import {
  applyExperience, buildAdventureEncounter, deriveCombatSeed, dispatchAdventureCommand,
  type AdventureCommand, type AdventureState,
} from "../../src/adventure";
import { applyCharacterAdvancement, pendingCharacterAdvancements } from "../../src/character";
import { createCombat } from "../../src/game";
import { previewLoadoutChange, validatePartyLoadout } from "../../src/loadout";
import { act, adventure, adventureContext, context, HERO, SECOND } from "../support/session";

function step(state: AdventureState, input: AdventureCommand): AdventureState {
  const result = dispatchAdventureCommand(state, input, adventureContext);
  expect(result.accepted, result.error).toBe(true);
  return result.state;
}
function resultInput(state: AdventureState, outcome: "victory" | "defeat" = "victory"): AdventureCommand {
  return { type: "accept-combat-result", result: {
    encounterId: state.currentEncounterId!, combatSeed: deriveCombatSeed(state.adventureSeed, state.currentEncounterId!),
    outcome, finalCombatHash: "settled-at-combat-boundary",
  } };
}

describe("G-ADVENTURE settlement", () => {
  it("victory awards EXP and one selected reward once; stale results and reward choices do nothing", () => {
    const combat = step(adventure().adventure!, { type: "start-encounter" });
    const input = resultInput(combat);
    const won = step(combat, input);
    expect(won.party.members[HERO]!.progression.experience).toBe(200);
    expect(won.completedEncounterIds).toEqual(["encounter.road-ambush"]);
    expect(won.phase).toBe("reward");
    for (const invalid of [input, { type: "choose-reward", rewardId: won.pendingReward!.rewardId, choiceIndex: 100 } as const]) {
      const refused = dispatchAdventureCommand(won, invalid, adventureContext);
      expect(refused.accepted).toBe(false);
      expect(refused.state).toEqual(won);
    }
    const choice = { type: "choose-reward", rewardId: won.pendingReward!.rewardId, choiceIndex: 0 } as const;
    const rewarded = step(won, choice);
    expect(rewarded.collection.cards["card.brace-behind-cover"]).toBe((won.collection.cards["card.brace-behind-cover"] ?? 0) + 1);
    expect(rewarded.phase).toBe("between-encounters");
    expect(rewarded.currentEncounterId).toBe("encounter.spear-line");
    const duplicate = dispatchAdventureCommand(rewarded, choice, adventureContext);
    expect(duplicate.accepted).toBe(false);
    expect(duplicate.state).toEqual(rewarded);
  });

  it("defeat grants no EXP/reward and does not permit another encounter", () => {
    const combat = step(adventure().adventure!, { type: "start-encounter" });
    const failed = step(combat, resultInput(combat, "defeat"));
    expect(failed.phase).toBe("failed");
    expect(failed.pendingReward).toBeNull();
    expect(failed.collection).toEqual(combat.collection);
    expect(failed.party).toEqual(combat.party);
    expect(dispatchAdventureCommand(failed, { type: "start-encounter" }, adventureContext).accepted).toBe(false);
  });

  it("a result for a different encounter or seed cannot settle this battle", () => {
    const combat = step(adventure().adventure!, { type: "start-encounter" });
    const input = resultInput(combat);
    if (input.type !== "accept-combat-result") throw new Error("Expected result input");
    for (const result of [{ ...input.result, encounterId: "encounter.spear-line" }, { ...input.result, combatSeed: input.result.combatSeed + 1 }]) {
      const refused = dispatchAdventureCommand(combat, { type: "accept-combat-result", result }, adventureContext);
      expect(refused.accepted).toBe(false);
      expect(refused.state).toEqual(combat);
    }
  });
});

describe("G-GROWTH progression and next battle", () => {
  it.each([[999, 0, 1, 999], [999, 1, 2, 0], [900, 2200, 4, 100]])("%i EXP plus %i crosses the correct thresholds", (experience, award, level, remainder) => {
    const before = { level: 1, experience, advancements: [] };
    expect(applyExperience(before, award).progression).toEqual({ level, experience: remainder, advancements: [] });
    expect(before).toEqual({ level: 1, experience, advancements: [] });
  });

  it("pending skill advancement prevents departure, validates the choice once, then reaches combat", () => {
    const ready = adventure().adventure!;
    const member = ready.party.members[HERO]!;
    const grown = { ...ready, party: { members: { [HERO]: { ...member, progression: { level: 3, experience: 0, advancements: [] } } } } };
    expect(pendingCharacterAdvancements(3, [])).toEqual([3]);
    expect(dispatchAdventureCommand(grown, { type: "start-encounter" }, adventureContext).accepted).toBe(false);
    const actor = context.pack.actorDefinitions[member.actorDefinitionId]!;
    const identity = { traits: actor.traits, build: actor.character!.build };
    expect(() => applyCharacterAdvancement(grown.party.members[HERO]!.progression, { level: 5, skillIncrease: "athletics" }, identity, context.pack.characterRules)).toThrow();
    const advanced = step(grown, { type: "advance-character", memberId: HERO, choice: { level: 3, skillIncrease: "athletics" } });
    expect(dispatchAdventureCommand(advanced, { type: "advance-character", memberId: HERO, choice: { level: 3, skillIncrease: "athletics" } }, adventureContext).accepted).toBe(false);
    const encounter = buildAdventureEncounter(context.pack, step(advanced, { type: "start-encounter" }));
    const combat = createCombat(encounter.definition, encounter.seed).state;
    expect(combat.actors[HERO]!.statProfile).toMatchObject({ kind: "character", stats: { level: 3, skills: { athletics: "expert" } } });
  });
});

describe("G-LOADOUT ownership and explicit mutation", () => {
  it("preview is inert; accepted removal changes the next combat equipment and deck", () => {
    const session = adventure();
    const state = session.adventure!;
    const member = state.party.members[HERO]!;
    const before = structuredClone(state);
    const replacement = { equipment: {}, preparedCards: [] };
    expect(previewLoadoutChange(state.party, state.collection, context.pack, HERO, replacement).legal).toBe(true);
    expect(state).toEqual(before);
    const changed = act(session, { type: "set-loadout", memberId: HERO, loadout: replacement });
    const combat = act(changed, { type: "start-encounter" }).combat!;
    expect(combat.actors[HERO]!.equipmentIds).toEqual([]);
    expect(combat.actors[HERO]!.deckContributions.some(c => c.source.kind === "prepared" || c.source.kind === "equipment-trait")).toBe(false);
    expect(member.loadout.equipment.weapon).toBe("halberd");
  });

  it("party-wide inventory, slot, capacity, class and level limits reject illegal preparation", () => {
    const state = adventure(true).adventure!;
    const member = state.party.members[HERO]!;
    const validate = (loadout: typeof member.loadout, collection = state.collection) => validatePartyLoadout({ members: { ...state.party.members, [HERO]: { ...member, loadout } } }, collection, context.pack);
    const cases = [
      [{ ...member.loadout, equipment: { ...member.loadout.equipment, armor: "halberd" } }, state.collection, "SLOT_MISMATCH"],
      [member.loadout, { ...state.collection, equipment: { ...state.collection.equipment, halberd: 0 } }, "EQUIPMENT_COPIES_EXCEEDED"],
      [{ ...member.loadout, preparedCards: ["card.demoralize", "card.demoralize", "card.demoralize", "card.demoralize"] }, { ...state.collection, cards: { ...state.collection.cards, "card.demoralize": 10 } }, "PREPARED_CAPACITY_EXCEEDED"],
      [{ ...member.loadout, preparedCards: ["card.demoralize", "card.demoralize"] }, { ...state.collection, cards: { ...state.collection.cards, "card.demoralize": 1 } }, "CARD_COPIES_EXCEEDED"],
      [{ ...member.loadout, preparedCards: ["card.combat-grab"] }, { ...state.collection, cards: { ...state.collection.cards, "card.combat-grab": 1 } }, "CARD_LEVEL_TOO_LOW"],
      [{ ...member.loadout, preparedCards: ["card.lay-on-hands"] }, { ...state.collection, cards: { ...state.collection.cards, "card.lay-on-hands": 1 } }, "INELIGIBLE_CARD"],
    ] as const;
    for (const [loadout, collection, code] of cases) {
      const result = validate(loadout, collection);
      expect(result.valid, code).toBe(false);
      expect(result.issues.map(issue => issue.code)).toContain(code);
    }
  });
});

it("G-LOADOUT two individually legal loadouts cannot allocate the same final copy", () => {
  const state = adventure(true).adventure!;
  const party = { members: Object.fromEntries(Object.entries(state.party.members).map(([id, member]) => [id, {
    ...member, loadout: { ...member.loadout, preparedCards: ["card.demoralize"] },
  }])) };
  const collection = { ...state.collection, cards: { ...state.collection.cards, "card.demoralize": 1 } };
  for (const id of [HERO, SECOND]) {
    expect(validatePartyLoadout({ members: { [id]: party.members[id]! } }, collection, context.pack).valid).toBe(true);
  }
  expect(validatePartyLoadout(party, collection, context.pack).issues.map(issue => issue.code)).toContain("CARD_COPIES_EXCEEDED");
});
