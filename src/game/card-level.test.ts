import { describe, expect, it } from "vitest";
import schema from "../../content/schema/content-pack.schema.json";
import { createCoreContentSource, createTacticalCombatFixture } from "../../tests/fixtures/content";
import { PRODUCTION_CONTENT } from "../content/production-content";
import { fingerprintContentPack } from "../content/fingerprint";
import { validateContentPackStructure } from "../content/validate-content";
import { validateContentPackSemantics } from "../content/validate-semantics";
import { resolveCardEligibility } from "./capabilities";
import { createCombat, dispatchCombatCommand } from "./engine";
import { listLegalActions, listLegalTargets, previewAction } from "./queries";
import { createStartingCollection, deriveTacticalDeck, previewLoadoutChange } from "../loadout";
import type { CardDefinition, CombatCommand, CombatState } from "./types";
import { rewardAvailability } from "../../tools/content/reward-availability";

const pack = PRODUCTION_CONTENT.pack;
const content = pack.combatContent;
const actor = (id: string, level: number) => ({ traits: [{ id }], statProfile: { kind: "character" as const, stats: { level } } });

describe("Card level contract", () => {
  it.each([undefined, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN])("rejects invalid authored levels: %s", level => {
    const source = createCoreContentSource();
    const invalid = { ...source, cards: source.cards.map(card => ({ ...card, level })) };
    expect(validateContentPackStructure(invalid, schema).length).toBeGreaterThan(0);
    expect(validateContentPackSemantics(invalid as typeof source).some(issue => issue.code === "INVALID_CARD_LEVEL")).toBe(true);
  });

  it("validates overrides and fingerprints their values independently of key order", () => {
    const source = createCoreContentSource();
    const card: CardDefinition = { ...source.cards[0]!, level: 1, traits: [{ id: "fighter" }, { id: "champion" }], levelByClass: { fighter: 1, champion: 6 } };
    const valid = { ...source, cards: [card, ...source.cards.slice(1)] };
    const fingerprint = fingerprintContentPack(valid);
    expect(fingerprintContentPack({ ...valid, cards: [{ ...card, levelByClass: { champion: 6, fighter: 1 } }, ...source.cards.slice(1)] })).toBe(fingerprint);
    expect(fingerprintContentPack({ ...valid, cards: [{ ...card, levelByClass: { fighter: 1, champion: 5 } }, ...source.cards.slice(1)] })).not.toBe(fingerprint);
    for (const levelByClass of [{ ghost: 2 }, { wizard: 2 }, { fighter: 0 }, { fighter: 1.5 }, { fighter: Number.MAX_SAFE_INTEGER + 1 }]) {
      const issues = validateContentPackSemantics({ ...valid, cards: [{ ...card, levelByClass }, ...source.cards.slice(1)] });
      expect(issues.some(issue => issue.code.startsWith("INVALID_CARD_LEVEL"))).toBe(true);
    }
  });

  it("honors the Class-specific threshold, fallback, and Creature boundary", () => {
    const card = content.cards["card.reactive-strike"]!;
    expect(resolveCardEligibility(actor("fighter", 1), card, content).eligible).toBe(true);
    for (const [level, eligible] of [[5, false], [6, true], [7, true]] as const) {
      expect(resolveCardEligibility(actor("champion", level), card, content)).toMatchObject({ eligible, requiredLevel: 6, currentLevel: level });
    }
    expect(resolveCardEligibility(actor("wizard", 20), card, content)).toMatchObject({ eligible: false, code: "INELIGIBLE_CARD" });
    expect(resolveCardEligibility(actor("fighter", 1), { ...card, level: 2, levelByClass: { champion: 6 } }, content))
      .toMatchObject({ eligible: false, requiredLevel: 2 });
    expect(resolveCardEligibility({ statProfile: { kind: "creature" }, traits: [] }, card, content).eligible).toBe(true);
  });

  it("uses runtime growth for preparation, equipment grants, and statistics together", () => {
    const definition = pack.actorDefinitions["hero.aerin"]!;
    const member = { id: "hero", actorDefinitionId: definition.id, loadout: definition.starterLoadout, progression: { level: 1, experience: 0, advancements: [] } };
    const party = { members: { hero: member } };
    const starting = createStartingCollection(party, pack);
    const collection = { cards: { ...starting.cards, "card.combat-grab": 1 }, equipment: { ...starting.equipment, "dueling-rapier": 1 } };
    for (const candidate of [
      { ...member.loadout, preparedCards: [...member.loadout.preparedCards, "card.combat-grab"] },
      { ...member.loadout, equipment: { ...member.loadout.equipment, weapon: "dueling-rapier" } },
    ]) {
      expect(previewLoadoutChange(party, collection, pack, "hero", candidate).validation.issues.map(issue => issue.code)).toEqual(["CARD_LEVEL_TOO_LOW"]);
      const grown = { members: { hero: { ...member, progression: { ...member.progression, level: 2 } } } };
      const preview = previewLoadoutChange(grown, collection, pack, "hero", candidate);
      expect(preview.legal).toBe(true);
      expect(preview.after!.statistics.maxHp).toBe(30);
      expect(preview.before.statistics.maxHp).toBe(30);
    }
    expect(definition.statProfile.kind === "character" && definition.statProfile.stats.level).toBe(1);
  });

  it("checks initial base, prepared, and equipment grants at the content boundary", () => {
    const source = createCoreContentSource();
    for (const id of ["card.trip", "card.reactive-strike"]) {
      const invalid = { ...source, cards: source.cards.map(card => card.id === id ? { ...card, level: 2 } : card) };
      expect(validateContentPackSemantics(invalid).some(issue => issue.code === "CARD_LEVEL_TOO_LOW")).toBe(true);
    }
  });

  it("displays an injected locked hand card but refuses targets, preview, and execution without consumption", () => {
    const fixture = createTacticalCombatFixture();
    const opened = createCombat(fixture, 1).state;
    const card = { ...fixture.content.cards["card.trip"]!, level: 2 };
    const rules = { ...fixture.content, cards: { ...fixture.content.cards, [card.id]: card } };
    const state: CombatState = { ...opened, turn: { ...opened.turn, activeActorId: "hero", activeIndex: opened.turn.initiativeOrder.indexOf("hero") },
      cardZones: { ...opened.cardZones, hero: { ...opened.cardZones.hero!, hand: [{ id: "locked", definitionId: card.id, source: { kind: "prepared", memberId: "hero" } }] } } };
    const source = { kind: "card" as const, id: "locked" };
    expect(listLegalActions(state, "hero", rules).find(action => action.source.id === "locked"))
      .toMatchObject({ enabled: false, reason: expect.stringContaining("요구 레벨 2"), cardRequirement: { requiredLevel: 2, currentLevel: 1 } });
    expect(listLegalTargets(state, "hero", source, rules)).toEqual([]);
    const target = { kind: "actor" as const, actorId: "goblin-skirmisher" };
    expect(previewAction(state, "hero", source, target, rules).legal).toBe(false);
    const result = dispatchCombatCommand(state, { type: "use-action", id: "locked-command", sequence: state.sequence + 1, actorId: "hero", action: source, target }, rules);
    expect(result.accepted).toBe(false);
    expect(result.state).toBe(state);
    expect(result.events).toEqual([]);
  });

  it("gates Reaction offers and revalidates the threshold before accepting", () => {
    const fixture = createTacticalCombatFixture();
    const opened = createCombat(fixture, 1).state;
    const original = opened.actors.hero!;
    if (original.statProfile.kind !== "character") throw new Error("Character required");
    const card = content.cards["card.reactive-strike"]!;
    const rules = { ...fixture.content, cards: { ...fixture.content.cards, [card.id]: card } };
    const state: CombatState = { ...opened, actors: { ...opened.actors,
      hero: { ...original, position: { x: 1, y: 1 }, facing: "east", traits: [{ id: "champion" }], reactionAvailable: true,
        statProfile: { kind: "character", stats: { ...original.statProfile.stats, level: 6 } } },
      "goblin-skirmisher": { ...opened.actors["goblin-skirmisher"]!, position: { x: 2, y: 1 } } },
      turn: { ...opened.turn, activeActorId: "goblin-skirmisher", activeIndex: opened.turn.initiativeOrder.indexOf("goblin-skirmisher") },
      cardZones: { ...opened.cardZones, hero: { ...opened.cardZones.hero!, hand: [{ id: "reaction", definitionId: card.id, source: { kind: "prepared", memberId: "hero" } }] } } };
    const move: CombatCommand = { type: "use-action", id: "move", sequence: state.sequence + 1, actorId: "goblin-skirmisher", action: { kind: "basic", id: "stride" }, target: { kind: "tile", position: { x: 3, y: 1 } } };
    const triggered = dispatchCombatCommand(state, move, rules).state;
    expect(triggered.pendingReaction?.candidates[0]?.actorId).toBe("hero");
    const reaction: CombatCommand = { type: "use-reaction", id: "react", sequence: triggered.sequence + 1, actorId: "hero", triggerId: triggered.pendingReaction!.triggerId, cardInstanceId: "reaction" };
    expect(dispatchCombatCommand(triggered, reaction, rules).accepted).toBe(true);
    const originalStats = original.statProfile.stats;
    const lower = (value: CombatState): CombatState => ({ ...value, actors: { ...value.actors, hero: { ...value.actors.hero!, statProfile: { kind: "character", stats: { ...originalStats, level: 5 } } } } });
    expect(dispatchCombatCommand(lower(state), move, rules).state.pendingReaction).toBeNull();
    const stale = lower(triggered);
    const refused = dispatchCombatCommand(stale, reaction, rules);
    expect(refused.accepted).toBe(false);
    expect(refused.state).toBe(stale);
    expect(refused.events).toEqual([]);
  });

  it("audits the approved production deck counts and growth-gated rewards", () => {
    for (const id of ["halberd", "executioner-axe", "flick-mace"]) {
      const deck = deriveTacticalDeck(pack.actorDefinitions["hero.aerin"]!, { equipment: { weapon: id }, preparedCards: [] }, content, "hero");
      expect(deck.contributions.filter(entry => entry.cardDefinitionId === "card.trip").reduce((n, entry) => n + entry.count, 0)).toBe(1);
    }
    for (const [id, count] of [["hero.aerin", 8], ["hero.brom", 7]] as const) {
      const definition = pack.actorDefinitions[id]!;
      expect(deriveTacticalDeck(definition, definition.starterLoadout, content, id).totalCards).toBe(count);
    }
    const adventure = PRODUCTION_CONTENT.adventure;
    const spear = adventure.rewards.find(reward => reward.id === "reward.spear-line")!;
    const index = spear.choices.findIndex(choice => choice.definitionId === "card.combat-grab");
    const availability = rewardAvailability(pack, adventure, pack.actorDefinitions["hero.aerin"]!, spear);
    expect(availability.immediate[index]).toBe(false);
    expect(availability.eventual[index]).toBe(true);
  });
});
