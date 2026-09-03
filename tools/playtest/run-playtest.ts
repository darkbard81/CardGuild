import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";

import { buildAdventureEncounter } from "../../src/adventure/combat-bridge";
import { createAdventureSession, dispatchAdventureCommand, deriveCombatSeed } from "../../src/adventure/runtime";
import type { AdventureState, PartyState } from "../../src/adventure/types";
import type { ActorDefinition, CompiledContentPack } from "../../src/content/content-types";
import { PRODUCTION_CONTENT } from "../../src/content/production-content";
import { chooseAiCommand } from "../../src/game/ai";
import { createCombat, dispatchCombatCommand } from "../../src/game/engine";
import { hashCombatState } from "../../src/game/replay";
import type {
  ActorState,
  CombatCommand,
  CombatContent,
  CombatEvent,
  CombatState,
} from "../../src/game/types";
import { EQUIPMENT_SLOT_ORDER, deriveLoadoutSnapshot } from "../../src/loadout";
import type { PartyMemberLoadout } from "../../src/loadout";
import { chooseHeroCommand, chooseReactionCommand } from "./hero-policy";

/**
 * The #21 playtest harness: it plays the shipped Adventure instead of asserting about it.
 *
 * Everything here runs the production path — `createAdventureSession`,
 * `buildAdventureEncounter`, `createCombat`, `dispatchCombatCommand`, `chooseAiCommand` —
 * so a run is a real playthrough, seeded and replayable. The heroes are played by
 * `hero-policy.ts`; the enemies are played by the shipped creature AI. No gameplay rule,
 * balance solver or telemetry system is added: this file only records what happened.
 *
 * Usage: `npm run playtest -- [--seeds 5] [--json out.json]`
 */

const MAX_COMBAT_COMMANDS = 4000;
const MAX_ROUNDS = 40;

type RewardRoute = "first" | "last" | "alternate";
type LoadoutPolicy = "authored" | "adapt";

interface RunSpec {
  readonly id: string;
  readonly label: string;
  readonly starterIds: readonly string[];
  readonly rewardRoute: RewardRoute;
  readonly loadoutPolicy: LoadoutPolicy;
}

interface EncounterReport {
  readonly encounterId: string;
  readonly outcome: "victory" | "defeat" | "stalled";
  readonly rounds: number;
  readonly enemies: number;
  readonly heroHpLossPercent: number;
  readonly damageToHeroes: number;
  readonly damageToEnemies: number;
  readonly healing: number;
  readonly heroTurns: number;
  readonly enemyTurns: number;
  readonly enemyIdleTurns: number;
  readonly enemyStrideOnlyTurns: number;
  readonly heroIdleTurns: number;
  readonly rejectedCommands: number;
}

interface RunReport {
  readonly specId: string;
  readonly label: string;
  readonly seed: number;
  readonly partySize: number;
  readonly starterIds: readonly string[];
  readonly rewardRoute: RewardRoute;
  readonly loadoutPolicy: LoadoutPolicy;
  readonly completed: boolean;
  readonly failedAt: string | null;
  readonly rewardPicks: readonly string[];
  readonly finalLoadouts: Readonly<Record<string, PartyMemberLoadout>>;
  readonly encounters: readonly EncounterReport[];
}

/** Counters shared by every run in one invocation, so dead content shows up across the matrix. */
interface Tally {
  readonly heroActionUse: Map<string, number>;
  readonly enemyActionUse: Map<string, number>;
  readonly cardOffered: Map<string, number>;
  readonly cardPlayed: Map<string, number>;
  readonly equipmentWorn: Map<string, number>;
  readonly rewardPicks: Map<string, number>;
  readonly creatureTurns: Map<string, number>;
  readonly creatureIdleTurns: Map<string, number>;
  readonly creatureInnateUse: Map<string, number>;
  readonly conditionsApplied: Map<string, number>;
  readonly noCommand: Map<string, number>;
}

function createTally(): Tally {
  return {
    heroActionUse: new Map(),
    enemyActionUse: new Map(),
    cardOffered: new Map(),
    cardPlayed: new Map(),
    equipmentWorn: new Map(),
    rewardPicks: new Map(),
    creatureTurns: new Map(),
    creatureIdleTurns: new Map(),
    creatureInnateUse: new Map(),
    conditionsApplied: new Map(),
    noCommand: new Map(),
  };
}

function bump(counter: Map<string, number>, key: string, amount = 1): void {
  counter.set(key, (counter.get(key) ?? 0) + amount);
}

function starters(pack: CompiledContentPack): readonly ActorDefinition[] {
  return Object.values(pack.actorDefinitions)
    .filter((actor) => actor.traits.some((trait) => trait.id === "playable"))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function party(pack: CompiledContentPack, starterIds: readonly string[]): PartyState {
  return {
    members: Object.fromEntries(
      starterIds.map((actorDefinitionId, index) => {
        const seat = (index + 1) as 1 | 2 | 3;
        const definition = pack.actorDefinitions[actorDefinitionId];
        if (!definition) throw new Error(`Unknown starter "${actorDefinitionId}".`);
        return [
          `party.hero-${String(seat)}`,
          {
            id: `party.hero-${String(seat)}`,
            seat,
            actorDefinitionId,
            loadout: {
              equipment: { ...definition.starterLoadout.equipment },
              preparedCards: [...definition.starterLoadout.preparedCards],
            },
          },
        ];
      }),
    ),
  };
}

interface CombatOutcomeReport {
  readonly state: CombatState;
  readonly report: Omit<EncounterReport, "encounterId">;
}

function playCombat(
  definition: Parameters<typeof createCombat>[0],
  seed: number,
  content: CombatContent,
  tally: Tally,
): CombatOutcomeReport {
  let { state } = createCombat(definition, seed);
  const startingHeroHp = Object.values(state.actors)
    .filter((actor) => actor.team === "heroes")
    .reduce((total, actor) => total + actor.hp, 0);
  const enemies = Object.values(state.actors).filter((actor) => actor.team === "enemies").length;

  let rounds = 0;
  let damageToHeroes = 0;
  let damageToEnemies = 0;
  let healing = 0;
  let heroTurns = 0;
  let enemyTurns = 0;
  let enemyIdleTurns = 0;
  let enemyStrideOnlyTurns = 0;
  let heroIdleTurns = 0;
  let rejectedCommands = 0;
  let turnActions = 0;
  let turnStrides = 0;
  let commands = 0;

  const closeTurn = (actor: ActorState | undefined): void => {
    if (!actor) return;
    if (actor.team === "enemies") {
      enemyTurns += 1;
      bump(tally.creatureTurns, actor.definitionId);
      if (turnActions === 0) {
        enemyIdleTurns += 1;
        bump(tally.creatureIdleTurns, actor.definitionId);
      } else if (turnActions === turnStrides) {
        enemyStrideOnlyTurns += 1;
      }
    } else {
      heroTurns += 1;
      if (turnActions === 0) heroIdleTurns += 1;
    }
    turnActions = 0;
    turnStrides = 0;
  };

  const record = (events: readonly CombatEvent[], actor: ActorState | undefined): void => {
    for (const event of events) {
      switch (event.type) {
        case "TURN_STARTED":
          rounds = Math.max(rounds, event.round);
          break;
        case "DAMAGE_DEALT": {
          const target = state.actors[event.targetActorId];
          if (target?.team === "heroes") damageToHeroes += event.amount;
          else damageToEnemies += event.amount;
          break;
        }
        case "HP_RESTORED":
          healing += event.amount;
          break;
        case "CONDITION_APPLIED":
          bump(tally.conditionsApplied, event.condition);
          break;
        case "ACTION_SPENT": {
          const spender = state.actors[event.actorId];
          if (spender?.team === "heroes") bump(tally.heroActionUse, event.actionId);
          else {
            bump(tally.enemyActionUse, event.actionId);
            if (spender && spender.innateActionIds.includes(event.actionId)) {
              bump(tally.creatureInnateUse, `${spender.definitionId}:${event.actionId}`);
            }
          }
          if (spender?.id === actor?.id) {
            turnActions += 1;
            if (event.actionId === "stride" || event.actionId === "step") turnStrides += 1;
          }
          break;
        }
        default:
          break;
      }
    }
  };

  while (!state.outcome && commands < MAX_COMBAT_COMMANDS && rounds <= MAX_ROUNDS) {
    const actor = state.actors[state.turn.activeActorId];
    const command: CombatCommand | null = state.pendingReaction
      ? reactionCommand(state, tally)
      : actor?.team === "heroes"
        ? heroCommand(state, content, tally)
        : chooseAiCommand(state, content);
    if (!command) {
      bump(tally.noCommand, actor?.definitionId ?? "unknown");
      const forced: CombatCommand = {
        type: "end-turn",
        id: `forced-${String(state.sequence + 1)}`,
        sequence: state.sequence + 1,
        actorId: state.turn.activeActorId,
      };
      const fallback = dispatchCombatCommand(state, forced, content);
      if (!fallback.accepted) break;
      closeTurn(actor);
      record(fallback.events, actor);
      state = fallback.state;
      commands += 1;
      continue;
    }
    const result = dispatchCombatCommand(state, command, content);
    commands += 1;
    if (!result.accepted) {
      rejectedCommands += 1;
      const forced: CombatCommand = {
        type: "end-turn",
        id: `forced-${String(state.sequence + 1)}`,
        sequence: state.sequence + 1,
        actorId: state.turn.activeActorId,
      };
      const fallback = dispatchCombatCommand(state, forced, content);
      if (!fallback.accepted) break;
      closeTurn(actor);
      record(fallback.events, actor);
      state = fallback.state;
      continue;
    }
    if (command.type === "end-turn") closeTurn(actor);
    record(result.events, actor);
    state = result.state;
  }

  const remainingHeroHp = Object.values(state.actors)
    .filter((actor) => actor.team === "heroes")
    .reduce((total, actor) => total + Math.max(0, actor.hp), 0);

  return {
    state,
    report: {
      outcome: state.outcome ?? "stalled",
      rounds,
      enemies,
      heroHpLossPercent:
        startingHeroHp === 0 ? 0 : Math.round(((startingHeroHp - remainingHeroHp) / startingHeroHp) * 1000) / 10,
      damageToHeroes,
      damageToEnemies,
      healing,
      heroTurns,
      enemyTurns,
      enemyIdleTurns,
      enemyStrideOnlyTurns,
      heroIdleTurns,
      rejectedCommands,
    },
  };
}

/** Wraps the hero policy so what was on offer is counted, not only what was taken. */
function heroCommand(state: CombatState, content: CombatContent, tally: Tally): CombatCommand | null {
  const actor = state.actors[state.turn.activeActorId];
  const hand = actor ? state.cardZones[actor.id]?.hand ?? [] : [];
  const command = chooseHeroCommand(state, content);
  for (const card of hand) bump(tally.cardOffered, card.definitionId);
  if (command?.type === "use-action" && command.action.kind === "card") {
    const played = hand.find((card) => card.id === command.action.id);
    if (played) bump(tally.cardPlayed, played.definitionId);
  }
  return command;
}

/** A Reaction is a played Card too, and it never passes through `use-action`. */
function reactionCommand(state: CombatState, tally: Tally): CombatCommand | null {
  const command = chooseReactionCommand(state);
  if (command?.type === "use-reaction") {
    const card = state.cardZones[command.actorId]?.hand.find((candidate) => candidate.id === command.cardInstanceId);
    if (card) {
      bump(tally.cardOffered, card.definitionId);
      bump(tally.cardPlayed, card.definitionId);
    }
  }
  return command;
}

/** Equipment worth: one scalar so a swap is a comparison rather than a judgement call. */
function loadoutScore(actor: ActorDefinition, loadout: PartyMemberLoadout, content: CombatContent): number {
  const snapshot = deriveLoadoutSnapshot(actor, loadout, content, "playtest");
  const damage = snapshot.strike.damage;
  const averageDamage = (damage.count * (damage.sides + 1)) / 2 + damage.flatModifier;
  return (
    snapshot.statistics.ac * 2 +
    averageDamage +
    snapshot.strike.attackModifier * 0.5 +
    snapshot.statistics.reflex.modifier * 0.2 +
    snapshot.deck.totalCards * 0.1
  );
}

function adaptLoadout(
  actor: ActorDefinition,
  loadout: PartyMemberLoadout,
  owned: Readonly<Record<string, number>>,
  content: CombatContent,
  capacity: number,
  ownedCards: Readonly<Record<string, number>>,
  preparedElsewhere: ReadonlySet<string>,
  granted: readonly string[],
): PartyMemberLoadout {
  let best = loadout;
  for (const slot of EQUIPMENT_SLOT_ORDER) {
    for (const [equipmentId, count] of Object.entries(owned).sort(([left], [right]) => left.localeCompare(right))) {
      if (count <= 0) continue;
      const definition = content.equipment[equipmentId];
      if (!definition || definition.slot !== slot || best.equipment[slot] === equipmentId) continue;
      const candidate: PartyMemberLoadout = {
        equipment: { ...best.equipment, [slot]: equipmentId },
        preparedCards: [...best.preparedCards],
      };
      if (loadoutScore(actor, candidate, content) > loadoutScore(actor, best, content)) best = candidate;
    }
  }
  // A granted Card is only a real choice if someone prepares it, so free capacity takes one —
  // and it takes the newest reward first. Filling the slot alphabetically would hand it to
  // another starter's kit card and the Adventure's own rewards would never reach a deck.
  const prepared = [...best.preparedCards];
  const order = [
    ...[...granted].reverse(),
    ...Object.keys(ownedCards).sort((left, right) => left.localeCompare(right)),
  ];
  for (const cardId of order) {
    if (prepared.length >= capacity) break;
    if ((ownedCards[cardId] ?? 0) <= 0 || prepared.includes(cardId) || preparedElsewhere.has(cardId)) continue;
    if (!content.cards[cardId]) continue;
    prepared.push(cardId);
  }
  return { equipment: { ...best.equipment }, preparedCards: prepared };
}

function rewardChoiceIndex(route: RewardRoute, choices: number, rewardIndex: number): number {
  if (route === "first") return 0;
  if (route === "last") return choices - 1;
  return rewardIndex % choices;
}

function playAdventure(pack: CompiledContentPack, spec: RunSpec, seed: number, tally: Tally): RunReport {
  const context = {
    definition: PRODUCTION_CONTENT.adventure,
    actorDefinitions: pack.actorDefinitions,
    combatContent: pack.combatContent,
  };
  let state: AdventureState = createAdventureSession(context, party(pack, spec.starterIds), seed);
  const encounters: EncounterReport[] = [];
  const rewardPicks: string[] = [];
  const grantedCards: string[] = [];
  let rewardIndex = 0;
  let failedAt: string | null = null;

  const send = (command: Parameters<typeof dispatchAdventureCommand>[1]): void => {
    const result = dispatchAdventureCommand(state, command, context);
    if (!result.accepted) throw new Error(`Adventure rejected ${command.type}: ${result.error ?? "unknown"}`);
    state = result.state;
  };

  send({ type: "start-adventure" });
  let guard = 0;
  while (state.phase !== "complete" && state.phase !== "failed" && guard < 64) {
    guard += 1;
    if (state.phase === "between-encounters") {
      if (spec.loadoutPolicy === "adapt") {
        const taken = new Set<string>();
        const preparedElsewhere = new Set<string>();
        for (const member of Object.values(state.party.members).sort((left, right) => left.seat - right.seat)) {
          const actor = pack.actorDefinitions[member.actorDefinitionId];
          if (!actor) continue;
          const owned = { ...state.collection.equipment };
          for (const id of taken) owned[id] = (owned[id] ?? 0) - 1;
          const next = adaptLoadout(
            actor,
            member.loadout,
            owned,
            pack.combatContent,
            actor.loadoutProfile.preparedCardCapacity,
            state.collection.cards,
            preparedElsewhere,
            grantedCards,
          );
          const result = dispatchAdventureCommand(state, { type: "set-member-loadout", memberId: member.id, loadout: next }, context);
          if (result.accepted) state = result.state;
          const settled = state.party.members[member.id]?.loadout ?? member.loadout;
          for (const slot of EQUIPMENT_SLOT_ORDER) {
            const id = settled.equipment[slot];
            if (id) taken.add(id);
          }
          for (const cardId of settled.preparedCards) preparedElsewhere.add(cardId);
        }
      }
      send({ type: "start-encounter" });
      continue;
    }
    if (state.phase === "combat") {
      const encounterId = state.currentEncounterId;
      if (!encounterId) throw new Error("Combat phase without an encounter.");
      const encounter = buildAdventureEncounter(pack, state);
      const played = playCombat(encounter.definition, encounter.seed, pack.combatContent, tally);
      encounters.push({ encounterId, ...played.report });
      for (const member of Object.values(state.party.members)) {
        for (const slot of EQUIPMENT_SLOT_ORDER) {
          const id = member.loadout.equipment[slot];
          if (id) bump(tally.equipmentWorn, id);
        }
      }
      if (played.report.outcome !== "victory") {
        failedAt = encounterId;
        break;
      }
      send({
        type: "accept-combat-result",
        result: {
          encounterId,
          outcome: "victory",
          combatSeed: deriveCombatSeed(state.adventureSeed, encounterId),
          finalCombatHash: hashCombatState(played.state),
        },
      });
      continue;
    }
    if (state.phase === "reward") {
      const offer = state.pendingReward;
      if (!offer) throw new Error("Reward phase without an offer.");
      const choiceIndex = rewardChoiceIndex(spec.rewardRoute, offer.choices.length, rewardIndex);
      const grant = offer.choices[choiceIndex];
      rewardIndex += 1;
      if (grant) {
        rewardPicks.push(grant.definitionId);
        bump(tally.rewardPicks, grant.definitionId);
        if (grant.kind === "card") grantedCards.push(grant.definitionId);
      }
      send({ type: "choose-reward", rewardId: offer.rewardId, choiceIndex });
      continue;
    }
    throw new Error(`Unexpected adventure phase "${state.phase}".`);
  }

  return {
    specId: spec.id,
    label: spec.label,
    seed,
    partySize: spec.starterIds.length,
    starterIds: spec.starterIds,
    rewardRoute: spec.rewardRoute,
    loadoutPolicy: spec.loadoutPolicy,
    completed: state.phase === "complete",
    failedAt,
    rewardPicks,
    finalLoadouts: Object.fromEntries(
      Object.values(state.party.members).map((member) => [member.actorDefinitionId, member.loadout]),
    ),
    encounters,
  };
}

function buildMatrix(pack: CompiledContentPack): readonly RunSpec[] {
  const roster = starters(pack).map((actor) => actor.id);
  const pick = (id: string): string => {
    const found = roster.find((candidate) => candidate === id);
    if (!found) throw new Error(`The playtest matrix names starter "${id}", which the pack does not ship.`);
    return found;
  };
  const aerin = pick("hero.aerin");
  const brom = pick("hero.brom");
  const lyra = pick("hero.lyra");
  const nera = pick("hero.nera");
  const solo: readonly (readonly [string, string])[] = [
    [aerin, "1P vanguard"],
    [lyra, "1P skirmisher"],
    [brom, "1P guardian"],
    [nera, "1P support"],
  ];
  const parties: readonly (readonly [readonly string[], string])[] = [
    ...solo.map(([id, label]) => [[id], label] as const),
    [[aerin, lyra], "2P vanguard + skirmisher"],
    [[aerin, nera], "2P vanguard + support"],
    [[brom, lyra], "2P guardian + skirmisher"],
    [[aerin, lyra, nera], "3P vanguard + skirmisher + support"],
    [[brom, nera, lyra], "3P guardian + support + skirmisher"],
  ];
  // Reward route and loadout direction vary independently, so a difference between two runs
  // can be attributed to one of them rather than to both at once.
  const routes: readonly (readonly [RewardRoute, LoadoutPolicy])[] = [
    ["first", "authored"],
    ["first", "adapt"],
    ["last", "authored"],
    ["last", "adapt"],
  ];
  return parties.flatMap(([starterIds, label]) =>
    routes.map(([rewardRoute, loadoutPolicy]) => ({
      id: `${label.split(" ")[0] ?? ""}-${starterIds.map((id) => id.replace("hero.", "")).join("+")}-${rewardRoute}-${loadoutPolicy}`,
      label: `${label} / ${rewardRoute} reward / ${loadoutPolicy} loadout`,
      starterIds,
      rewardRoute,
      loadoutPolicy,
    })),
  );
}

function counterRows(counter: Map<string, number>): Readonly<Record<string, number>> {
  return Object.fromEntries([...counter.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function commit(): string {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const seedCount = Number(argv[argv.indexOf("--seeds") + 1]) || 3;
  const jsonIndex = argv.indexOf("--json");
  const pack = PRODUCTION_CONTENT.pack;
  const tally = createTally();
  const specs = buildMatrix(pack);
  const runs: RunReport[] = [];

  for (const spec of specs) {
    for (let seed = 1; seed <= seedCount; seed += 1) {
      runs.push(playAdventure(pack, spec, seed, tally));
    }
  }

  const completed = runs.filter((run) => run.completed).length;
  const allEncounters = runs.flatMap((run) => run.encounters);
  const cards = Object.keys(pack.combatContent.cards).sort();
  const deadCards = cards.filter((id) => (tally.cardOffered.get(id) ?? 0) === 0);
  const offeredNeverPlayed = cards.filter(
    (id) => (tally.cardOffered.get(id) ?? 0) > 0 && (tally.cardPlayed.get(id) ?? 0) === 0,
  );

  const report = {
    build: {
      commit: commit(),
      packId: pack.manifest.id,
      packVersion: pack.manifest.version,
      fingerprint: pack.fingerprint,
      adventureId: PRODUCTION_CONTENT.adventureId,
    },
    matrix: { specs: specs.length, seeds: seedCount, runs: runs.length },
    completion: { completed, total: runs.length },
    runs,
    tally: {
      heroActionUse: counterRows(tally.heroActionUse),
      enemyActionUse: counterRows(tally.enemyActionUse),
      cardOffered: counterRows(tally.cardOffered),
      cardPlayed: counterRows(tally.cardPlayed),
      equipmentWorn: counterRows(tally.equipmentWorn),
      rewardPicks: counterRows(tally.rewardPicks),
      creatureTurns: counterRows(tally.creatureTurns),
      creatureIdleTurns: counterRows(tally.creatureIdleTurns),
      creatureInnateUse: counterRows(tally.creatureInnateUse),
      conditionsApplied: counterRows(tally.conditionsApplied),
      noCommand: counterRows(tally.noCommand),
      deadCards,
      offeredNeverPlayed,
    },
  };

  if (jsonIndex >= 0) {
    const target = argv[jsonIndex + 1];
    if (!target) throw new Error("--json needs a path.");
    await writeFile(target, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }

  process.stdout.write(
    `Playtest ${report.build.packId}@${report.build.packVersion} ${report.build.fingerprint} (${report.build.commit})\n` +
      `  ${String(runs.length)} runs over ${String(specs.length)} specs x ${String(seedCount)} seeds: ` +
      `${String(completed)} completed, ${String(runs.length - completed)} failed\n`,
  );
  for (const run of runs) {
    const worst = [...run.encounters].sort((left, right) => right.heroHpLossPercent - left.heroHpLossPercent)[0];
    process.stdout.write(
      `  ${run.completed ? "PASS" : "FAIL"} seed ${String(run.seed)} ${run.label}` +
        `${run.failedAt ? ` @ ${run.failedAt}` : ""}` +
        ` | rounds ${String(run.encounters.reduce((total, encounter) => total + encounter.rounds, 0))}` +
        ` | worst HP loss ${String(worst?.heroHpLossPercent ?? 0)}% (${worst?.encounterId ?? "-"})\n`,
    );
  }
  const stalled = allEncounters.filter((encounter) => encounter.outcome === "stalled");
  if (stalled.length > 0) process.stdout.write(`  stalled encounters: ${String(stalled.length)}\n`);
  process.stdout.write(
    `  never in hand: ${deadCards.length > 0 ? deadCards.join(", ") : "none"}\n` +
      `  in hand but never played: ${offeredNeverPlayed.length > 0 ? offeredNeverPlayed.join(", ") : "none"}\n`,
  );
}

await main();
