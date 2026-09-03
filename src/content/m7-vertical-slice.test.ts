import { describe, expect, it } from "vitest";

import {
  buildAdventureEncounter,
  createAdventureSession,
  deriveCombatSeed,
  dispatchAdventureCommand,
  type AdventureRuntimeContext,
  type AdventureState,
  type EncounterResult,
  type PartyState,
} from "../adventure";
import { createCombat } from "../game/engine";
import { deriveLoadoutSnapshot, validatePartyLoadout } from "../loadout";
import { placementAppliesToPartySize } from "./content-types";
import { PRODUCTION_CONTENT } from "./production-content";

const PACK = PRODUCTION_CONTENT.pack;
const CONTENT = PACK.combatContent;
const ADVENTURE = PRODUCTION_CONTENT.adventure;
const PARTY_SIZES = [1, 2, 3] as const;

const CONTEXT: AdventureRuntimeContext = {
  definition: ADVENTURE,
  actorDefinitions: PACK.actorDefinitions,
  combatContent: CONTENT,
};

const STARTERS = Object.values(PACK.actorDefinitions)
  .filter((actor) => actor.traits.some((trait) => trait.id === "playable"))
  .map((actor) => actor.id)
  .sort();

/**
 * The onboarding beats #18 authored. #19 appends the main progression behind them, so the
 * "after onboarding" assertions below need to know where the prefix ends.
 */
const ONBOARDING_LENGTH = 4;

/**
 * Items #17 classified as `reserve`: each is dominated or unusable for every hero on the
 * current roster, so offering one would be a choice with no reason to take it.
 */
const RESERVE_EQUIPMENT = ["executioner-axe", "brigandine", "bloodied-talisman"] as const;

/**
 * #17's five build directions, copied from docs/m7-equipment-matrix.md §4 and reduced to the
 * `reward` items only — the baseline gear in those combinations (half-plate, shield,
 * scale-mail, leather-armor) is already worn, so an Adventure only has to hand out the rest.
 * docs/m7-equipment-matrix.md stays the source of truth: a direction is never shortened here
 * to make this file pass. Two assemblable directions are the acceptance floor.
 */
const BUILD_DIRECTIONS: Readonly<Record<string, readonly string[]>> = {
  "heavy breaker": ["greatsword", "tower-shield"],
  "dex controller": ["flick-mace", "scout-leather", "striders-boots"],
  "party support": ["medics-kit"],
  "defensive duelist": ["dueling-rapier", "buckler", "warding-charm"],
  "spell skirmisher": ["hexers-focus", "throwing-axes"],
};

/**
 * Whether one run could end up holding all of `items`, given that each reward offer yields a
 * single choice. Every item has to come from a different offer, so this is a small bipartite
 * matching and not a set-membership test.
 */
function canOwnTogether(items: readonly string[], groups: readonly (readonly string[])[]): boolean {
  const options = items.map((item) => groups.flatMap((group, index) => (group.includes(item) ? [index] : [])));
  if (options.some((option) => option.length === 0)) return false;
  const used = new Set<number>();
  const assign = (index: number): boolean => {
    if (index >= options.length) return true;
    for (const group of options[index] ?? []) {
      if (used.has(group)) continue;
      used.add(group);
      if (assign(index + 1)) return true;
      used.delete(group);
    }
    return false;
  };
  return assign(0);
}

function party(actorDefinitionIds: readonly string[]): PartyState {
  return {
    members: Object.fromEntries(actorDefinitionIds.map((actorDefinitionId, index) => {
      const definition = PACK.actorDefinitions[actorDefinitionId];
      if (!definition) throw new Error(`${actorDefinitionId} is missing.`);
      const id = `party.hero-${String(index + 1)}`;
      return [id, { id, seat: (index + 1) as 1 | 2 | 3, actorDefinitionId, loadout: definition.starterLoadout }];
    })),
  };
}

function victory(state: AdventureState): EncounterResult {
  const encounterId = state.currentEncounterId;
  if (!encounterId) throw new Error("No encounter is active.");
  return {
    encounterId,
    outcome: "victory",
    combatSeed: deriveCombatSeed(state.adventureSeed, encounterId),
    finalCombatHash: "0000000000000000",
  };
}

/** A creature's authored Max HP, the one threat number every enemy definition carries. */
function creatureHp(actorDefinitionId: string): number {
  const definition = PACK.actorDefinitions[actorDefinitionId];
  if (!definition) throw new Error(`${actorDefinitionId} is missing.`);
  return definition.statProfile.kind === "creature" ? definition.statProfile.stats.maxHp : 0;
}

/** Enemies this scenario actually fields at a party size, after #16's placement filter. */
function opposition(encounterId: string, partySize: number): readonly string[] {
  const source = PACK.scenarioSources[encounterId];
  if (!source) throw new Error(`${encounterId} is missing.`);
  return source.placements
    .filter((placement) => placementAppliesToPartySize(placement, partySize))
    .map((placement) => placement.actorDefinitionId);
}

describe("production vertical slice", () => {
  it("runs the whole slice as one adventure of six to eight library encounters", () => {
    expect(PRODUCTION_CONTENT.adventureId).toBe(ADVENTURE.id);
    expect(Object.keys(PACK.adventures)).toEqual([ADVENTURE.id]);
    expect(ADVENTURE.encounterIds.length).toBeGreaterThanOrEqual(6);
    expect(ADVENTURE.encounterIds.length).toBeLessThanOrEqual(8);
    expect(new Set(ADVENTURE.encounterIds).size).toBe(ADVENTURE.encounterIds.length);
    for (const encounterId of ADVENTURE.encounterIds) {
      const scenario = PACK.scenarios[encounterId];
      // No new objective kind: the finale is won the same way the opener is.
      expect(`${encounterId}:${scenario?.objective.kind ?? "missing"}`).toBe(`${encounterId}:defeat-all-enemies`);
    }
  });

  it("escalates the opposition from the opener to the finale at every party size", () => {
    const finale = ADVENTURE.encounterIds[ADVENTURE.encounterIds.length - 1] as string;
    for (const partySize of PARTY_SIZES) {
      // Body count stops separating fights once a solo party meets one creature at a time
      // (#21), so escalation is measured in fielded HP, which is authored on every creature
      // and moves with both composition and choice of creature.
      const threats = ADVENTURE.encounterIds.map((id) =>
        opposition(id, partySize).reduce((total, actorDefinitionId) => total + creatureHp(actorDefinitionId), 0));
      const opener = threats[0] as number;
      const last = threats[threats.length - 1] as number;
      expect(`${String(partySize)}P opener=${String(opener)}`)
        .toBe(`${String(partySize)}P opener=${String(Math.min(...threats))}`);
      // The finale fields strictly more than anything before it.
      expect(`${String(partySize)}P finale=${String(last)}`)
        .toBe(`${String(partySize)}P finale=${String(Math.max(...threats))}`);
      expect(threats.slice(0, -1).every((threat) => threat < last)).toBe(true);
      if (partySize === 1) continue;
      // Past onboarding, no encounter a real party meets is one enemy definition repeated.
      // Role is authored in the design matrix and is not runtime metadata, so this counts
      // distinct definitions and nothing more — two definitions that share a role still pass.
      // Role mix itself is a design review over docs/m7-vertical-slice.md.
      for (const encounterId of ADVENTURE.encounterIds.slice(ONBOARDING_LENGTH)) {
        const distinct = new Set(opposition(encounterId, partySize)).size;
        expect(`${encounterId}@${String(partySize)}P:${String(distinct >= 2)}`)
          .toBe(`${encounterId}@${String(partySize)}P:true`);
      }
    }
    // The finale is the only fight that puts three distinct definitions on the board at once.
    expect(new Set(opposition(finale, 3)).size).toBeGreaterThanOrEqual(3);
  });

  it("puts most of the shipped creature roster on the board", () => {
    const fielded = new Set(ADVENTURE.encounterIds.flatMap((id) => opposition(id, 3)));
    const roster = Object.values(PACK.actorDefinitions)
      .filter((actor) => !actor.traits.some((trait) => trait.id === "playable"))
      .map((actor) => actor.id);
    expect(fielded.size).toBeGreaterThanOrEqual(12);
    // Whatever is left out is left out deliberately, not because a scenario went missing.
    for (const actorDefinitionId of fielded) {
      expect(`${actorDefinitionId}:${String(roster.includes(actorDefinitionId))}`)
        .toBe(`${actorDefinitionId}:true`);
    }
  });

  it("opens the equipment pool only after onboarding, and never offers reserve or worn gear", () => {
    const onboarding = new Set(ADVENTURE.encounterIds.slice(0, ONBOARDING_LENGTH - 1));
    const worn = new Set(Object.values(PACK.actorDefinitions)
      .flatMap((actor) => Object.values(actor.starterLoadout.equipment))
      .filter((id): id is string => Boolean(id)));
    let equipmentOffers = 0;
    for (const reward of ADVENTURE.rewards) {
      expect(reward.choices.length).toBeGreaterThanOrEqual(2);
      for (const choice of reward.choices) {
        if (choice.kind !== "equipment") continue;
        equipmentOffers += 1;
        const id = choice.definitionId;
        expect(`${reward.id}/${id}:known=${String(Boolean(CONTENT.equipment[id]))}`)
          .toBe(`${reward.id}/${id}:known=true`);
        expect(`${reward.id}/${id}:onboarding=${String(onboarding.has(reward.afterEncounterId))}`)
          .toBe(`${reward.id}/${id}:onboarding=false`);
        expect(`${reward.id}/${id}:reserve=${String((RESERVE_EQUIPMENT as readonly string[]).includes(id))}`)
          .toBe(`${reward.id}/${id}:reserve=false`);
        expect(`${reward.id}/${id}:worn=${String(worn.has(id))}`).toBe(`${reward.id}/${id}:worn=false`);
      }
    }
    expect(equipmentOffers).toBeGreaterThanOrEqual(4);
  });

  it("hands out enough equipment to assemble at least two #17 build directions", () => {
    const groups = ADVENTURE.rewards
      .map((reward) => reward.choices.filter((choice) => choice.kind === "equipment").map((choice) => choice.definitionId))
      .filter((group) => group.length > 0);
    // A reward hands out one choice, not a shelf. Two items from the same offer can never be
    // owned together, so feasibility is an assignment of items to distinct offers rather than
    // membership in the union of everything ever printed on a choice screen.
    const assemblable = Object.entries(BUILD_DIRECTIONS)
      .filter(([, items]) => canOwnTogether(items, groups))
      .map(([direction]) => direction)
      .sort();
    expect(assemblable.length).toBeGreaterThanOrEqual(2);
    // What actually shipped, so a quiet drop shows up as a diff rather than a near miss.
    // #21 added a fourth choice to each equipment offer and moved Strider's Boots and the
    // Warding Charm into different offers, which is what makes the last two directions
    // reachable in one run rather than only on paper.
    expect(assemblable).toEqual([
      "defensive duelist",
      "dex controller",
      "heavy breaker",
      "party support",
      "spell skirmisher",
    ]);
    // The offers have to move more than one slot, or "direction" means nothing.
    const offered = new Set(groups.flat());
    const slots = new Set([...offered].map((id) => CONTENT.equipment[id]?.slot));
    expect(slots.size).toBeGreaterThanOrEqual(3);
  });

  it("keeps both reward and reward-free encounters in the run, and ends on a fight", () => {
    const rewarded = new Set(ADVENTURE.rewards.map((reward) => reward.afterEncounterId));
    const bare = ADVENTURE.encounterIds.filter((id) => !rewarded.has(id));
    expect(rewarded.size).toBeGreaterThanOrEqual(1);
    expect(bare.length).toBeGreaterThanOrEqual(1);
    for (const encounterId of rewarded) {
      expect(`${encounterId}:inRun=${String(ADVENTURE.encounterIds.includes(encounterId))}`)
        .toBe(`${encounterId}:inRun=true`);
    }
    // Victory is the last encounter's victory, not a reward screen.
    const finale = ADVENTURE.encounterIds[ADVENTURE.encounterIds.length - 1] as string;
    expect(rewarded.has(finale)).toBe(false);
  });

  it("carries an equipment reward through the loadout into the next encounter's combat", () => {
    // Aerin is the roster's martial expert, so a weapon swap moves a number the resolver
    // reads rather than only adding cards.
    let state = createAdventureSession(CONTEXT, party(["hero.aerin"]), 21);
    state = dispatchAdventureCommand(state, { type: "start-adventure" }, CONTEXT).state;
    let taken: { readonly rewardId: string; readonly definitionId: string } | null = null;
    for (let guard = 0; guard < 40 && !taken; guard += 1) {
      if (state.phase === "between-encounters") {
        state = dispatchAdventureCommand(state, { type: "start-encounter" }, CONTEXT).state;
        continue;
      }
      if (state.phase === "combat") {
        state = dispatchAdventureCommand(state, { type: "accept-combat-result", result: victory(state) }, CONTEXT).state;
        continue;
      }
      const offer = state.pendingReward;
      if (state.phase !== "reward" || !offer) throw new Error(`Adventure stalled in phase "${state.phase}".`);
      const index = offer.choices.findIndex((choice) => choice.kind === "equipment");
      const choice = offer.choices[index];
      state = dispatchAdventureCommand(state, { type: "choose-reward", rewardId: offer.rewardId, choiceIndex: Math.max(index, 0) }, CONTEXT).state;
      if (index >= 0 && choice) taken = { rewardId: offer.rewardId, definitionId: choice.definitionId };
    }
    if (!taken) throw new Error("The adventure never offered an equipment reward.");
    expect(state.collection.equipment[taken.definitionId]).toBe(1);

    const member = Object.values(state.party.members)[0];
    if (!member) throw new Error("The party is empty.");
    const definition = PACK.actorDefinitions[member.actorDefinitionId];
    if (!definition) throw new Error(`${member.actorDefinitionId} is missing.`);
    const equipment = CONTENT.equipment[taken.definitionId];
    if (!equipment) throw new Error(`${taken.definitionId} is missing.`);
    const loadout = {
      ...member.loadout,
      equipment: { ...member.loadout.equipment, [equipment.slot]: equipment.id },
    };

    // The change goes through the same command the Loadout screen sends, so a rejection here
    // is a rejection in the UI too.
    const changed = dispatchAdventureCommand(state, { type: "set-member-loadout", memberId: member.id, loadout }, CONTEXT);
    expect(changed.accepted).toBe(true);
    state = changed.state;
    expect(validatePartyLoadout(state.party, state.collection, PACK).issues).toEqual([]);

    // Resolver-visible before/after, not just an id in a list.
    const before = deriveLoadoutSnapshot(definition, member.loadout, CONTENT, member.id);
    const after = deriveLoadoutSnapshot(definition, loadout, CONTENT, member.id);
    expect(after.equipmentIds).toContain(equipment.id);
    const granted = equipment.traits.flatMap((trait) => CONTENT.traits[trait.id]?.cardGrants ?? []);
    if (granted.length > 0) {
      const beforeCards = new Set(before.deck.contributions.map((entry) => entry.cardDefinitionId));
      for (const grant of granted) {
        expect(`${grant.cardDefinitionId}:new=${String(!beforeCards.has(grant.cardDefinitionId))}`)
          .toBe(`${grant.cardDefinitionId}:new=true`);
      }
    } else {
      expect(JSON.stringify(after.strike)).not.toBe(JSON.stringify(before.strike));
    }

    const started = dispatchAdventureCommand(state, { type: "start-encounter" }, CONTEXT);
    expect(started.accepted).toBe(true);
    const encounter = buildAdventureEncounter(PACK, started.state);
    const { state: combat } = createCombat(encounter.definition, encounter.seed);
    const hero = Object.values(combat.actors).find((actor) => actor.team === "heroes");
    if (!hero) throw new Error("The hero never reached the board.");
    expect(hero.equipmentIds).toContain(equipment.id);
    const deck = [...(combat.cardZones[hero.id]?.hand ?? []), ...(combat.cardZones[hero.id]?.drawPile ?? [])];
    for (const grant of granted) {
      expect(`${grant.cardDefinitionId}:inDeck=${String(deck.some((card) => card.definitionId === grant.cardDefinitionId))}`)
        .toBe(`${grant.cardDefinitionId}:inDeck=true`);
    }
  });

  // One representative roster per party size — the first 1, 2 and 3 starters. Per-starter solo
  // completion is m7-tutorial.test.ts's "completes with every starter, at every party size";
  // every starter against every party size and build is #21's playtest matrix, not this file's.
  it("builds a legal board at 1P, 2P and 3P, all the way to the finale", () => {
    for (const partySize of PARTY_SIZES) {
      const roster = STARTERS.slice(0, partySize);
      let state = createAdventureSession(CONTEXT, party(roster), 21);
      state = dispatchAdventureCommand(state, { type: "start-adventure" }, CONTEXT).state;
      const played: string[] = [];
      for (let guard = 0; guard < 60 && state.phase !== "complete"; guard += 1) {
        if (state.phase === "between-encounters") {
          state = dispatchAdventureCommand(state, { type: "start-encounter" }, CONTEXT).state;
          continue;
        }
        if (state.phase === "combat") {
          const encounter = buildAdventureEncounter(PACK, state);
          const actors = encounter.definition.scenario.actors;
          const heroes = actors.filter((actor) => actor.team === "heroes");
          const enemies = actors.filter((actor) => actor.team === "enemies");
          const id = state.currentEncounterId as string;
          played.push(id);
          expect(`${id}@${String(partySize)}P heroes=${String(heroes.length)}`)
            .toBe(`${id}@${String(partySize)}P heroes=${String(partySize)}`);
          expect(`${id}@${String(partySize)}P enemies=${String(enemies.length)}`)
            .toBe(`${id}@${String(partySize)}P enemies=${String(opposition(id, partySize).length)}`);
          state = dispatchAdventureCommand(state, { type: "accept-combat-result", result: victory(state) }, CONTEXT).state;
          continue;
        }
        const offer = state.pendingReward;
        if (state.phase !== "reward" || !offer) throw new Error(`Adventure stalled in phase "${state.phase}".`);
        state = dispatchAdventureCommand(state, { type: "choose-reward", rewardId: offer.rewardId, choiceIndex: 0 }, CONTEXT).state;
      }
      expect(`${String(partySize)}P:${state.phase}`).toBe(`${String(partySize)}P:complete`);
      expect(played).toEqual([...ADVENTURE.encounterIds]);
    }
  });
});
