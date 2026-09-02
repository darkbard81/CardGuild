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
import { listLegalActions } from "../game/queries";
import { createStartingCollection, validatePartyLoadout } from "../loadout";
import { PRODUCTION_CONTENT } from "./production-content";

const PACK = PRODUCTION_CONTENT.pack;
const CONTENT = PACK.combatContent;
const ADVENTURE = PRODUCTION_CONTENT.adventure;

const CONTEXT: AdventureRuntimeContext = {
  definition: ADVENTURE,
  actorDefinitions: PACK.actorDefinitions,
  combatContent: CONTENT,
};

const STARTERS = Object.values(PACK.actorDefinitions)
  .filter((actor) => actor.traits.some((trait) => trait.id === "playable"))
  .map((actor) => actor.id)
  .sort();

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
    // The runtime re-derives this seed and rejects a result that does not match it.
    combatSeed: deriveCombatSeed(state.adventureSeed, encounterId),
    finalCombatHash: "0000000000000000",
  };
}

/** Plays the whole adventure, always taking the first reward on offer. */
function runToCompletion(roster: readonly string[]): {
  readonly state: AdventureState;
  readonly encounters: readonly string[];
  readonly rewards: readonly string[];
} {
  let state = createAdventureSession(CONTEXT, party(roster), 21);
  state = dispatchAdventureCommand(state, { type: "start-adventure" }, CONTEXT).state;
  const encounters: string[] = [];
  const rewards: string[] = [];
  for (let guard = 0; guard < 24 && state.phase !== "complete"; guard += 1) {
    if (state.phase === "between-encounters") {
      const started = dispatchAdventureCommand(state, { type: "start-encounter" }, CONTEXT);
      expect(started.accepted).toBe(true);
      state = started.state;
      if (state.currentEncounterId) encounters.push(state.currentEncounterId);
      continue;
    }
    if (state.phase === "combat") {
      // Every encounter is reachable and buildable with this party before it is resolved.
      expect(buildAdventureEncounter(PACK, state).definition.scenario.actors.length).toBeGreaterThan(1);
      const accepted = dispatchAdventureCommand(state, { type: "accept-combat-result", result: victory(state) }, CONTEXT);
      expect(accepted.accepted).toBe(true);
      state = accepted.state;
      continue;
    }
    if (state.phase === "reward" && state.pendingReward) {
      const offer = state.pendingReward;
      rewards.push(offer.rewardId);
      const chosen = dispatchAdventureCommand(state, { type: "choose-reward", rewardId: offer.rewardId, choiceIndex: 0 }, CONTEXT);
      expect(chosen.accepted).toBe(true);
      state = chosen.state;
      continue;
    }
    throw new Error(`Adventure stalled in phase "${state.phase}".`);
  }
  return { state, encounters, rewards };
}

describe("tutorial onboarding prefix", () => {
  it("uses the one authoritative adventure rather than a tutorial-only entry", () => {
    expect(PRODUCTION_CONTENT.adventureId).toBe("adventure.goblin-trouble");
    expect(ADVENTURE.id).toBe(PRODUCTION_CONTENT.adventureId);
    const playableAdventures = Object.values(PACK.adventures);
    expect(playableAdventures.some((adventure) => adventure.id === PRODUCTION_CONTENT.adventureId)).toBe(true);
  });

  it("orders three to four encounters, all drawn from the shipped library", () => {
    expect(ADVENTURE.encounterIds.length).toBeGreaterThanOrEqual(3);
    expect(ADVENTURE.encounterIds.length).toBeLessThanOrEqual(4);
    for (const encounterId of ADVENTURE.encounterIds) {
      expect(`${encounterId}:${String(Boolean(PACK.scenarioSources[encounterId]))}`).toBe(`${encounterId}:true`);
    }
    // Complexity climbs: the opener is the smallest board with the fewest enemies.
    const sizes = ADVENTURE.encounterIds.map((id) => {
      const source = PACK.scenarioSources[id];
      if (!source) throw new Error(`${id} is missing.`);
      return source.map.width * source.map.height;
    });
    expect(sizes[0]).toBe(Math.min(...sizes));
  });

  it("offers at least one reward the party can take without any #17 equipment", () => {
    expect(ADVENTURE.rewards.length).toBeGreaterThanOrEqual(1);
    // Baseline equipment is what a starter already owns; anything else would make the
    // tutorial depend on the reward pool #17 owns.
    const baseline = new Set(Object.values(PACK.actorDefinitions)
      .flatMap((actor) => Object.values(actor.starterLoadout.equipment))
      .filter((id): id is string => Boolean(id)));
    for (const reward of ADVENTURE.rewards) {
      expect(reward.choices.length).toBeGreaterThanOrEqual(2);
      for (const choice of reward.choices) {
        const known = choice.kind === "card"
          ? Boolean(CONTENT.cards[choice.definitionId])
          : baseline.has(choice.definitionId);
        expect(`${reward.id}/${choice.definitionId}:${String(known)}`).toBe(`${reward.id}/${choice.definitionId}:true`);
      }
    }
  });

  it("completes with every starter, at every party size", () => {
    for (const starter of STARTERS) {
      const solo = runToCompletion([starter]);
      expect(`${starter}:${solo.state.phase}`).toBe(`${starter}:complete`);
      expect(solo.encounters).toEqual([...ADVENTURE.encounterIds]);
      // Rewards arrive in encounter order; the authored array is normalised by id.
      const inPlayOrder = ADVENTURE.encounterIds.flatMap((encounterId) =>
        ADVENTURE.rewards.filter((reward) => reward.afterEncounterId === encounterId).map((reward) => reward.id));
      expect(solo.rewards).toEqual(inPlayOrder);
    }
    for (const size of [2, 3] as const) {
      const run = runToCompletion(STARTERS.slice(0, size));
      expect(`${String(size)}P:${run.state.phase}`).toBe(`${String(size)}P:complete`);
    }
  });

  it("keeps a reward usable as a prepared card in the next encounter", () => {
    let state = createAdventureSession(CONTEXT, party([STARTERS[0] as string]), 21);
    state = dispatchAdventureCommand(state, { type: "start-adventure" }, CONTEXT).state;
    state = dispatchAdventureCommand(state, { type: "start-encounter" }, CONTEXT).state;
    state = dispatchAdventureCommand(state, { type: "accept-combat-result", result: victory(state) }, CONTEXT).state;
    const offer = state.pendingReward;
    if (!offer) throw new Error("The first encounter offered no reward.");
    const cardIndex = offer.choices.findIndex((choice) => choice.kind === "card");
    expect(cardIndex).toBeGreaterThanOrEqual(0);
    const cardId = offer.choices[cardIndex]?.definitionId as string;
    state = dispatchAdventureCommand(state, { type: "choose-reward", rewardId: offer.rewardId, choiceIndex: cardIndex }, CONTEXT).state;
    expect(state.collection.cards[cardId]).toBe(1);

    // Preparing the reward has to survive the same collection validation the UI runs.
    const member = Object.values(state.party.members)[0];
    if (!member) throw new Error("The party is empty.");
    const prepared = {
      members: {
        [member.id]: {
          ...member,
          loadout: { ...member.loadout, preparedCards: [...member.loadout.preparedCards, cardId] },
        },
      },
    };
    expect(validatePartyLoadout(prepared, state.collection, PACK).issues).toEqual([]);

    const withCard: AdventureState = { ...state, party: prepared };
    const next = dispatchAdventureCommand(withCard, { type: "start-encounter" }, CONTEXT);
    expect(next.accepted).toBe(true);
    const encounter = buildAdventureEncounter(PACK, next.state);
    const { state: combat } = createCombat(encounter.definition, encounter.seed);
    const hero = Object.values(combat.actors).find((actor) => actor.team === "heroes");
    if (!hero) throw new Error("The hero never reached the board.");
    const deck = [
      ...(combat.cardZones[hero.id]?.hand ?? []),
      ...(combat.cardZones[hero.id]?.drawPile ?? []),
    ];
    expect(deck.some((card) => card.definitionId === cardId && card.source.kind === "prepared")).toBe(true);
  });

  it("never offers a starter a reward it already has equipped", () => {
    // An equipment reward that duplicates a starter's own gear changes nothing: the slot is
    // already filled by the same item, so Manage Loadout shows no new option. Onboarding is
    // where that lands worst, so every tutorial reward has to move something.
    for (const definition of Object.values(PACK.actorDefinitions)) {
      if (!definition.traits.some((trait) => trait.id === "playable")) continue;
      const equipped = new Set(Object.values(definition.starterLoadout.equipment).filter(Boolean));
      for (const reward of ADVENTURE.rewards) {
        for (const choice of reward.choices) {
          const dead = choice.kind === "equipment" && equipped.has(choice.definitionId);
          expect(`${definition.id}/${reward.id}/${choice.definitionId}:dead=${String(dead)}`)
            .toBe(`${definition.id}/${reward.id}/${choice.definitionId}:dead=false`);
        }
      }
    }
  });

  it("lets a solo starter prepare either side of every reward", () => {
    // A card copy always changes deck composition, but it still has to fit the Character's
    // remaining prepared capacity for the choice to be real.
    for (const definition of Object.values(PACK.actorDefinitions)) {
      if (!definition.traits.some((trait) => trait.id === "playable")) continue;
      const free = definition.loadoutProfile.preparedCardCapacity - definition.starterLoadout.preparedCards.length;
      expect(`${definition.id}:free=${String(free >= 1)}`).toBe(`${definition.id}:free=true`);
      for (const reward of ADVENTURE.rewards) {
        for (const choice of reward.choices) {
          if (choice.kind !== "card") continue;
          const member = { id: "party.hero-1", seat: 1 as const, actorDefinitionId: definition.id, loadout: definition.starterLoadout };
          const collection = { equipment: {}, cards: { [choice.definitionId]: 1 } };
          const prepared = {
            members: {
              [member.id]: {
                ...member,
                loadout: { ...member.loadout, preparedCards: [...member.loadout.preparedCards, choice.definitionId] },
              },
            },
          };
          const issues = validatePartyLoadout(prepared, {
            equipment: Object.fromEntries(Object.values(definition.starterLoadout.equipment).filter(Boolean).map((id) => [id as string, 1])),
            cards: { ...collection.cards, ...Object.fromEntries(definition.starterLoadout.preparedCards.map((id) => [id, 1])) },
          }, PACK).issues;
          expect(`${definition.id}/${choice.definitionId}:${JSON.stringify(issues)}`)
            .toBe(`${definition.id}/${choice.definitionId}:[]`);
        }
      }
    }
  });

  it("gives every starter a legal action on the opening board", () => {
    for (const starter of STARTERS) {
      let state = createAdventureSession(CONTEXT, party([starter]), 21);
      state = dispatchAdventureCommand(state, { type: "start-adventure" }, CONTEXT).state;
      state = dispatchAdventureCommand(state, { type: "start-encounter" }, CONTEXT).state;
      const encounter = buildAdventureEncounter(PACK, state);
      const { state: combat } = createCombat(encounter.definition, encounter.seed);
      const hero = Object.values(combat.actors).find((actor) => actor.team === "heroes");
      if (!hero) throw new Error(`${starter} never reached the board.`);
      const collection = createStartingCollection(state.party, PACK);
      expect(`${starter}:${JSON.stringify(validatePartyLoadout(state.party, collection, PACK).issues)}`)
        .toBe(`${starter}:[]`);
      const legal = listLegalActions(combat, hero.id, CONTENT);
      expect(`${starter}:${String(legal.length > 0)}`).toBe(`${starter}:true`);
    }
  });
});
