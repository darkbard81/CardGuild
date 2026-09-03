import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { buildAdventureEncounter } from "../../src/adventure/combat-bridge";
import { createAdventureSession } from "../../src/adventure/runtime";
import type { AdventureState, PartyState } from "../../src/adventure/types";
import { getContentIdentity } from "../../src/content/compile-content";
import { PARTY_SIZES } from "../../src/content/content-types";
import type {
  ActorDefinition,
  CompiledContentPack,
  ContentValidationIssue,
  PartySizeNumber,
  ScenarioSource,
} from "../../src/content/content-types";
import { PRODUCTION_CONTENT } from "../../src/content/production-content";
import { formatContentValidationIssue } from "../../src/content/validate-semantics";
import { createCombat } from "../../src/game/engine";
import type { ActorState } from "../../src/game/types";
import {
  EQUIPMENT_SLOT_ORDER,
  createStartingCollection,
  deriveTacticalDeck,
  validatePartyLoadout,
} from "../../src/loadout";
import type { LoadoutCollection, PartyMemberLoadout } from "../../src/loadout";
import { M7_PRODUCTION_POLICY, type ReserveEntry, type VolumeRange } from "./m7-production-policy";

/**
 * The release gate for the pack `PRODUCTION_CONTENT` actually ships.
 *
 * `npm run content:check` stays the generic validator: it walks every milestone
 * pack under `content/` and says whether each one is a valid pack at all. This
 * command asks a different question — whether the *current M7 release* is
 * complete — and it asks it of the authoritative pack only, so the M3 and M6
 * regression fixtures are never held to M7 volume or reachability targets.
 *
 * It deliberately owns no rules of its own. Loadouts are judged by
 * `validatePartyLoadout`, decks by `deriveTacticalDeck`, encounters by the real
 * `createAdventureSession` → `buildAdventureEncounter` → `createCombat` path,
 * and party-size applicability by #16's `placementAppliesToPartySize` inside
 * that path. Schema, reference and fingerprint validity belong to
 * `content:check`; asset validity belongs to `assets:check`. What is left here,
 * and only here, is the release policy in `m7-production-policy.ts`.
 */

const POLICY_SOURCE = "tools/content/m7-production-policy.ts";
const PACK_SOURCE = "src/content/production-content.ts";
const ASSET_MANIFEST_SOURCE = "presentation/m3/asset-manifest.json";
const FOLLOW_UP_PATTERN = /^#[1-9][0-9]*$/;
/** A party the coverage pass can always assemble, so a failure is about the Encounter. */
const COVERAGE_SEED = 1;

interface Reporter {
  issue(source: string, path: string, code: string, message: string, definitionId?: string): void;
}

function createReporter(issues: ContentValidationIssue[], packId: string): Reporter {
  return {
    issue(source, path, code, message, definitionId) {
      issues.push({ packId, source, path, code, message, definitionId });
    },
  };
}

function isPlayable(actor: ActorDefinition): boolean {
  return actor.traits.some((trait) => trait.id === "playable");
}

function sortedById<T extends { readonly id: string }>(values: readonly T[]): readonly T[] {
  return [...values].sort((left, right) => left.id.localeCompare(right.id));
}

function withinRange(count: number, range: VolumeRange): boolean {
  return count >= range.min && count <= range.max;
}

/**
 * What a player can actually get to, walked the way the game walks it: the
 * authoritative Adventure's encounters, the Actors those encounters place, the
 * four starters, and everything a starter or a reward can put in a deck.
 */
interface ReachableContent {
  readonly starters: readonly ActorDefinition[];
  readonly scenarios: readonly ScenarioSource[];
  readonly actorIds: ReadonlySet<string>;
  readonly enemyIds: ReadonlySet<string>;
  readonly equipmentIds: ReadonlySet<string>;
  readonly cardIds: ReadonlySet<string>;
}

/** Every card the runtime would put in this member's deck with this loadout. */
function deckCardIds(
  actor: ActorDefinition,
  loadout: PartyMemberLoadout,
  pack: CompiledContentPack,
): readonly string[] {
  return deriveTacticalDeck(actor, loadout, pack.combatContent, `reach.${actor.id}`)
    .contributions.map((contribution) => contribution.cardDefinitionId);
}

function collectReachable(pack: CompiledContentPack, reporter: Reporter): ReachableContent {
  const adventure = PRODUCTION_CONTENT.adventure;
  const starters = sortedById(Object.values(pack.actorDefinitions).filter(isPlayable));
  const scenarios = adventure.encounterIds
    .map((scenarioId) => pack.scenarioSources[scenarioId])
    .filter((scenario): scenario is ScenarioSource => Boolean(scenario));

  const actorIds = new Set<string>(starters.map((actor) => actor.id));
  const enemyIds = new Set<string>();
  for (const scenario of scenarios) {
    for (const placement of scenario.placements) {
      actorIds.add(placement.actorDefinitionId);
      enemyIds.add(placement.actorDefinitionId);
    }
  }

  const equipmentIds = new Set<string>();
  const cardIds = new Set<string>();
  // Whatever an Actor the Adventure spawns already wears or knows.
  for (const actorId of [...actorIds].sort()) {
    const actor = pack.actorDefinitions[actorId];
    if (!actor) continue;
    for (const slot of EQUIPMENT_SLOT_ORDER) {
      const id = actor.starterLoadout.equipment[slot];
      if (id) equipmentIds.add(id);
    }
    for (const cardId of deckCardIds(actor, actor.starterLoadout, pack)) cardIds.add(cardId);
  }

  // Whatever a reward can hand the party, judged by whether a starter can use it.
  for (const reward of adventure.rewards) {
    for (const choice of reward.choices) {
      if (choice.kind === "card") {
        cardIds.add(choice.definitionId);
        if (!starters.some((starter) => canPrepare(starter, choice.definitionId, pack))) {
          reporter.issue(
            PACK_SOURCE,
            `adventure.rewards.${reward.id}`,
            "PRODUCTION_REWARD_UNUSABLE",
            `No starter can prepare reward card "${choice.definitionId}".`,
            reward.id,
          );
        }
        continue;
      }
      equipmentIds.add(choice.definitionId);
      const wearers = starters.filter((starter) => canEquip(starter, choice.definitionId, pack));
      if (wearers.length === 0) {
        reporter.issue(
          PACK_SOURCE,
          `adventure.rewards.${reward.id}`,
          "PRODUCTION_REWARD_UNUSABLE",
          `No starter can equip reward equipment "${choice.definitionId}".`,
          reward.id,
        );
        continue;
      }
      // A reward weapon or shield can carry Card grants of its own, and those Cards are
      // reachable exactly when the item is.
      for (const starter of wearers) {
        for (const cardId of deckCardIds(starter, equippedLoadout(starter, choice.definitionId, pack), pack)) {
          cardIds.add(cardId);
        }
      }
    }
  }

  return { starters, scenarios, actorIds, enemyIds, equipmentIds, cardIds };
}

/** The starter's authored loadout with one item swapped into its own slot. */
function equippedLoadout(
  starter: ActorDefinition,
  equipmentId: string,
  pack: CompiledContentPack,
): PartyMemberLoadout {
  const definition = pack.combatContent.equipment[equipmentId];
  if (!definition) return starter.starterLoadout;
  return {
    equipment: { ...starter.starterLoadout.equipment, [definition.slot]: definition.id },
    preparedCards: [...starter.starterLoadout.preparedCards],
  };
}

function soloParty(starter: ActorDefinition, loadout: PartyMemberLoadout): PartyState {
  return {
    members: {
      "party.hero-1": {
        id: "party.hero-1",
        seat: 1,
        actorDefinitionId: starter.id,
        loadout,
      },
    },
  };
}

/** Owning one extra copy of a definition, on top of what the starter walks in with. */
function collectionWith(
  base: LoadoutCollection,
  kind: "equipment" | "cards",
  definitionId: string,
): LoadoutCollection {
  const bucket = { ...base[kind], [definitionId]: (base[kind][definitionId] ?? 0) + 1 };
  return kind === "equipment" ? { ...base, equipment: bucket } : { ...base, cards: bucket };
}

function canEquip(starter: ActorDefinition, equipmentId: string, pack: CompiledContentPack): boolean {
  const loadout = equippedLoadout(starter, equipmentId, pack);
  const party = soloParty(starter, loadout);
  const collection = collectionWith(
    createStartingCollection(soloParty(starter, starter.starterLoadout), pack),
    "equipment",
    equipmentId,
  );
  return validatePartyLoadout(party, collection, pack).valid;
}

function canPrepare(starter: ActorDefinition, cardId: string, pack: CompiledContentPack): boolean {
  const loadout: PartyMemberLoadout = {
    equipment: { ...starter.starterLoadout.equipment },
    preparedCards: [...starter.starterLoadout.preparedCards, cardId],
  };
  const party = soloParty(starter, loadout);
  const collection = collectionWith(
    createStartingCollection(soloParty(starter, starter.starterLoadout), pack),
    "cards",
    cardId,
  );
  return validatePartyLoadout(party, collection, pack).valid;
}

function checkIdentity(pack: CompiledContentPack, reporter: Reporter): void {
  const policy = M7_PRODUCTION_POLICY;
  if (pack.manifest.id !== policy.packId) {
    reporter.issue(
      PACK_SOURCE,
      "manifest.id",
      "PRODUCTION_PACK_MISMATCH",
      `PRODUCTION_CONTENT ships "${pack.manifest.id}" but the release policy describes "${policy.packId}".`,
    );
  }
  if (PRODUCTION_CONTENT.adventureId !== policy.adventureId) {
    reporter.issue(
      PACK_SOURCE,
      "adventureId",
      "PRODUCTION_ADVENTURE_MISMATCH",
      `PRODUCTION_CONTENT selects "${PRODUCTION_CONTENT.adventureId}" but the release policy describes "${policy.adventureId}".`,
    );
  }
  const adventureIds = Object.keys(pack.adventures);
  if (adventureIds.length !== 1 || adventureIds[0] !== PRODUCTION_CONTENT.adventureId) {
    reporter.issue(
      PACK_SOURCE,
      "adventures",
      "PRODUCTION_ADVENTURE_NOT_SINGULAR",
      `The release ships exactly one authoritative Adventure, but the pack holds [${adventureIds.join(", ")}].`,
    );
  }
  if (pack.adventures[PRODUCTION_CONTENT.adventureId] !== PRODUCTION_CONTENT.adventure) {
    reporter.issue(
      PACK_SOURCE,
      "adventure",
      "PRODUCTION_ADVENTURE_DETACHED",
      "PRODUCTION_CONTENT.adventure is not the Adventure its own pack compiled.",
    );
  }
  const identity = getContentIdentity(pack);
  const shipped = PRODUCTION_CONTENT.contentIdentity;
  if (
    identity.packId !== shipped.packId ||
    identity.packVersion !== shipped.packVersion ||
    identity.fingerprint !== shipped.fingerprint
  ) {
    reporter.issue(
      PACK_SOURCE,
      "contentIdentity",
      "PRODUCTION_CONTENT_IDENTITY_DRIFT",
      `The shipped content identity ${shipped.packId}@${shipped.packVersion} ${shipped.fingerprint} is not the pack's own ${identity.packId}@${identity.packVersion} ${identity.fingerprint}.`,
    );
  }
}

interface ReserveList {
  readonly label: string;
  readonly field: string;
  readonly entries: readonly ReserveEntry[];
  readonly known: ReadonlySet<string>;
  readonly reachable: ReadonlySet<string>;
}

/**
 * Reserve entries have to be reviewable claims rather than a mute allowlist: the ID has to
 * exist, appear once, carry a reason and an owning issue, stay out of the tutorial prefix —
 * and still be unreachable. A reserve entry the Adventure has started using is reported as
 * stale, so the list cannot outlive the decision that created it.
 */
function checkReserve(lists: readonly ReserveList[], reporter: Reporter): void {
  const seen = new Map<string, string>();
  const tutorial = new Set<string>(M7_PRODUCTION_POLICY.tutorialEncounterIds);
  for (const list of lists) {
    list.entries.forEach((entry, index) => {
      const at = `${list.field}[${index}]`;
      const previous = seen.get(entry.id);
      if (previous) {
        reporter.issue(POLICY_SOURCE, at, "RESERVE_DUPLICATE", `"${entry.id}" is already reserved in ${previous}.`, entry.id);
      }
      seen.set(entry.id, list.field);
      if (!list.known.has(entry.id)) {
        reporter.issue(POLICY_SOURCE, at, "RESERVE_UNKNOWN_ID", `Reserved ${list.label} "${entry.id}" is not in the production pack.`, entry.id);
        return;
      }
      if (entry.reason.trim().length === 0) {
        reporter.issue(POLICY_SOURCE, `${at}.reason`, "RESERVE_MISSING_REASON", `Reserved ${list.label} "${entry.id}" does not say why it ships unreachable.`, entry.id);
      }
      if (!FOLLOW_UP_PATTERN.test(entry.followUp)) {
        reporter.issue(POLICY_SOURCE, `${at}.followUp`, "RESERVE_MISSING_FOLLOW_UP", `Reserved ${list.label} "${entry.id}" must name the issue that settles it, as "#<number>".`, entry.id);
      }
      if (tutorial.has(entry.id)) {
        reporter.issue(POLICY_SOURCE, at, "RESERVE_TUTORIAL_CONFLICT", `"${entry.id}" is reserved and also part of the tutorial prefix.`, entry.id);
      }
      if (list.reachable.has(entry.id)) {
        reporter.issue(POLICY_SOURCE, at, "RESERVE_STALE", `Reserved ${list.label} "${entry.id}" is reachable in the shipped Adventure. Retire the reserve entry rather than keeping it as an exemption.`, entry.id);
      }
    });
  }
}

/** Everything the pack authors but nothing reaches, minus what the policy owns up to. */
function checkOrphans(lists: readonly ReserveList[], reporter: Reporter): void {
  for (const list of lists) {
    const reserved = new Set(list.entries.map((entry) => entry.id));
    for (const id of [...list.known].sort()) {
      if (list.reachable.has(id) || reserved.has(id)) continue;
      reporter.issue(
        PACK_SOURCE,
        list.field,
        "PRODUCTION_ORPHAN",
        `${list.label} "${id}" is unreachable from the shipped Adventure. Give it a path or reserve it in ${POLICY_SOURCE}.`,
        id,
      );
    }
  }
}

function checkVolume(pack: CompiledContentPack, reachable: ReachableContent, reporter: Reporter): void {
  const policy = M7_PRODUCTION_POLICY;
  const actors = Object.values(pack.actorDefinitions);
  const counts: readonly (readonly [string, number, VolumeRange])[] = [
    ["playable starters", actors.filter(isPlayable).length, policy.volume.starters],
    ["player cards", Object.keys(pack.combatContent.cards).length, policy.volume.playerCards],
    ["enemies", actors.filter((actor) => actor.statProfile.kind === "creature").length, policy.volume.enemies],
    ["scenario sources", Object.keys(pack.scenarioSources).length, policy.volume.scenarios],
    ["equipment", Object.keys(pack.combatContent.equipment).length, policy.volume.equipment],
    ["adventure encounters", PRODUCTION_CONTENT.adventure.encounterIds.length, policy.volume.adventureEncounters],
    ["tutorial encounters", policy.tutorialEncounterIds.length, policy.volume.tutorialPrefix],
  ];
  for (const [label, count, range] of counts) {
    if (withinRange(count, range)) continue;
    reporter.issue(
      PACK_SOURCE,
      "volume",
      "PRODUCTION_VOLUME",
      `The release ships ${count} ${label}; the M7 target is ${range.min}-${range.max}.`,
    );
  }

  const floors: readonly (readonly [string, number, number])[] = [
    ["player cards", reachable.cardIds.size, policy.reachableMinimum.playerCards],
    ["equipment", reachable.equipmentIds.size, policy.reachableMinimum.equipment],
    ["enemies", reachable.enemyIds.size, policy.reachableMinimum.enemies],
    ["scenarios", reachable.scenarios.length, policy.reachableMinimum.scenarios],
  ];
  for (const [label, count, minimum] of floors) {
    if (count >= minimum) continue;
    reporter.issue(
      PACK_SOURCE,
      "reachableMinimum",
      "PRODUCTION_REACHABLE_FLOOR",
      `Only ${count} ${label} are reachable; the release contract is at least ${minimum}. Reserving more content does not satisfy this floor.`,
    );
  }
}

function checkTutorialPrefix(reporter: Reporter): void {
  const tutorial = M7_PRODUCTION_POLICY.tutorialEncounterIds;
  const encounterIds = PRODUCTION_CONTENT.adventure.encounterIds;
  tutorial.forEach((encounterId, index) => {
    const actual = encounterIds[index];
    if (actual === encounterId) return;
    reporter.issue(
      POLICY_SOURCE,
      `tutorialEncounterIds[${index}]`,
      "TUTORIAL_PREFIX_MISMATCH",
      encounterIds.includes(encounterId)
        ? `Tutorial encounter "${encounterId}" is Encounter ${String(encounterIds.indexOf(encounterId) + 1)} of the Adventure, not ${String(index + 1)}. The tutorial has to be a contiguous prefix, in order.`
        : `Tutorial encounter "${encounterId}" is not in the shipped Adventure.`,
      encounterId,
    );
  });
  const duplicates = tutorial.filter((id, index) => tutorial.indexOf(id) !== index);
  for (const duplicate of duplicates) {
    reporter.issue(POLICY_SOURCE, "tutorialEncounterIds", "TUTORIAL_PREFIX_DUPLICATE", `Tutorial encounter "${duplicate}" is listed twice.`, duplicate);
  }
}

/** The four starters have to be able to walk in wearing exactly what they were authored with. */
function checkStarterLoadouts(
  pack: CompiledContentPack,
  reachable: ReachableContent,
  reporter: Reporter,
): void {
  for (const starter of reachable.starters) {
    const party = soloParty(starter, starter.starterLoadout);
    const collection = createStartingCollection(party, pack);
    const validation = validatePartyLoadout(party, collection, pack);
    for (const issue of validation.issues) {
      reporter.issue(PACK_SOURCE, "actors.starterLoadout", `STARTER_${issue.code}`, `${starter.name}: ${issue.message}`, starter.id);
    }
    for (const grant of starter.baseCardGrants) {
      if (pack.combatContent.cards[grant.cardDefinitionId]) continue;
      reporter.issue(PACK_SOURCE, "actors.baseCardGrants", "STARTER_UNKNOWN_CARD", `${starter.name} is granted missing card "${grant.cardDefinitionId}".`, starter.id);
    }
    for (const slot of ["weapon", "armor"] as const) {
      if (starter.starterLoadout.equipment[slot]) continue;
      reporter.issue(PACK_SOURCE, "actors.starterLoadout", "STARTER_EMPTY_SLOT", `${starter.name} starts with no ${slot}.`, starter.id);
    }
  }
}

function coverageParty(starters: readonly ActorDefinition[], partySize: PartySizeNumber): PartyState {
  const members = starters.slice(0, partySize).map((starter, index) => {
    const seat = (index + 1) as 1 | 2 | 3;
    return [
      `party.hero-${String(seat)}`,
      {
        id: `party.hero-${String(seat)}`,
        seat,
        actorDefinitionId: starter.id,
        loadout: {
          equipment: { ...starter.starterLoadout.equipment },
          preparedCards: [...starter.starterLoadout.preparedCards],
        },
      },
    ] as const;
  });
  return { members: Object.fromEntries(members) };
}

function composition(actors: readonly ActorState[]): string {
  return sortedById(actors)
    .map((actor) => `${actor.id}:${actor.definitionId}:${actor.team}:${String(actor.position.x)},${String(actor.position.y)}`)
    .join("|");
}

/**
 * Every Encounter of the shipped Adventure has to be structurally buildable at 1P, 2P and 3P.
 * This runs the real runtime path, so #16's `placementAppliesToPartySize` decides which static
 * Actors exist and no applicability rule is restated here. Balance is #21's question; this only
 * asks whether a party can be put on the board at all.
 */
function checkPartySizeCoverage(
  pack: CompiledContentPack,
  reachable: ReachableContent,
  reporter: Reporter,
): void {
  const adventure = PRODUCTION_CONTENT.adventure;
  for (const partySize of PARTY_SIZES) {
    if (partySize < adventure.partySize.min || partySize > adventure.partySize.max) {
      reporter.issue(
        PACK_SOURCE,
        "adventure.partySize",
        "PRODUCTION_PARTY_SIZE_UNSUPPORTED",
        `The release contract covers 1P-3P, but the Adventure declares ${String(adventure.partySize.min)}-${String(adventure.partySize.max)}.`,
      );
      continue;
    }
    if (reachable.starters.length < partySize) continue;
    const party = coverageParty(reachable.starters, partySize);
    let session: AdventureState;
    try {
      session = createAdventureSession({
        definition: adventure,
        actorDefinitions: pack.actorDefinitions,
        combatContent: pack.combatContent,
      }, party, COVERAGE_SEED);
    } catch (error) {
      reporter.issue(PACK_SOURCE, `partySize[${String(partySize)}]`, "PRODUCTION_PARTY_UNBUILDABLE", `A ${String(partySize)}-member party cannot start the Adventure: ${String(error)}.`);
      continue;
    }

    for (const encounterId of adventure.encounterIds) {
      const state: AdventureState = { ...session, phase: "combat", currentEncounterId: encounterId };
      let actors: readonly ActorState[];
      try {
        const encounter = buildAdventureEncounter(pack, state);
        const combat = createCombat(encounter.definition, encounter.seed);
        actors = Object.values(combat.state.actors);
        // The same state has to compose the same board, or a replay of it means nothing.
        const rebuilt = buildAdventureEncounter(pack, state);
        if (composition(Object.values(createCombat(rebuilt.definition, rebuilt.seed).state.actors)) !== composition(actors)) {
          reporter.issue(PACK_SOURCE, `scenarios.${encounterId}`, "PRODUCTION_COMPOSITION_NONDETERMINISTIC", `Encounter "${encounterId}" composes differently at ${String(partySize)}P for the same Adventure state.`, encounterId);
        }
      } catch (error) {
        reporter.issue(PACK_SOURCE, `scenarios.${encounterId}`, "PRODUCTION_ENCOUNTER_UNBUILDABLE", `Encounter "${encounterId}" cannot be built for a ${String(partySize)}-member party: ${String(error)}.`, encounterId);
        continue;
      }

      const heroes = actors.filter((actor) => actor.team === "heroes");
      const enemies = actors.filter((actor) => actor.team === "enemies");
      if (heroes.length !== partySize) {
        reporter.issue(PACK_SOURCE, `scenarios.${encounterId}`, "PRODUCTION_MISSING_HERO_SLOT", `Encounter "${encounterId}" seats ${String(heroes.length)} of ${String(partySize)} party members.`, encounterId);
      }
      if (enemies.length === 0) {
        reporter.issue(PACK_SOURCE, `scenarios.${encounterId}`, "PRODUCTION_NO_THREAT", `Encounter "${encounterId}" spawns no enemy at ${String(partySize)}P.`, encounterId);
      }
      const occupied = new Map<string, string>();
      for (const actor of sortedById(actors)) {
        const key = `${String(actor.position.x)},${String(actor.position.y)}`;
        const holder = occupied.get(key);
        if (holder) {
          reporter.issue(PACK_SOURCE, `scenarios.${encounterId}`, "PRODUCTION_COMPOSITION_COLLISION", `"${actor.id}" and "${holder}" both start on ${key} at ${String(partySize)}P.`, encounterId);
        }
        occupied.set(key, actor.id);
      }
    }
  }
}

/**
 * The static half of AI coverage. #15's `creature-ai.test.ts` owns whether the AI actually
 * produces a command for every creature; this only makes sure the Adventure never spawns an
 * enemy with nothing authored to do, and it stays a reference check rather than a simulation.
 */
function checkAiCoverage(pack: CompiledContentPack, reachable: ReachableContent, reporter: Reporter): void {
  const aimable = new Set(["self", "none", "enemy", "ally", "creature"]);
  for (const actorId of [...reachable.enemyIds].sort()) {
    const actor = pack.actorDefinitions[actorId];
    if (!actor) continue;
    const strike = actor.statProfile.kind === "creature" ? actor.statProfile.stats.strike : undefined;
    const hasStrike = Boolean(strike) && strike !== undefined && strike.rangeFeet > 0 && strike.damage.count > 0;
    if (!hasStrike && actor.innateActionIds.length === 0) {
      reporter.issue(PACK_SOURCE, "actors", "PRODUCTION_AI_NO_PLAN", `Enemy "${actorId}" has neither a Fixed Strike nor an innate action, so the AI has nothing to take.`, actorId);
    }
    for (const actionId of actor.innateActionIds) {
      const action = pack.combatContent.actions[actionId];
      if (!action) {
        reporter.issue(PACK_SOURCE, "actors.innateActionIds", "PRODUCTION_AI_UNKNOWN_ACTION", `Enemy "${actorId}" names missing innate action "${actionId}".`, actorId);
        continue;
      }
      if (!aimable.has(action.targeting)) {
        reporter.issue(PACK_SOURCE, "actors.innateActionIds", "PRODUCTION_AI_UNAIMABLE_ACTION", `Enemy "${actorId}" declares innate action "${actionId}", which targets "${action.targeting}" and the AI has no policy for it.`, actorId);
      }
    }
  }
}

interface AssetVisuals {
  readonly actorVisuals: Readonly<Record<string, Readonly<Record<string, string>>>>;
  readonly equipmentVisuals: Readonly<Record<string, string>>;
  readonly cardVisuals: Readonly<Record<string, string>>;
}

/**
 * Visual coverage for the required production set. `assets:check` still owns whether an
 * asset is a valid asset — atlas geometry, alpha, canvas sizes — and it already requires the
 * equipment and card visual maps to match the shipped pack exactly. The only thing missing
 * there is which *Actors* the release has to be able to draw, which is a release question and
 * so is asked here.
 */
async function checkVisualCoverage(reachable: ReachableContent, reporter: Reporter): Promise<void> {
  const manifestPath = path.join(process.cwd(), "presentation", "m3", "asset-manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as AssetVisuals;
  for (const actorId of [...reachable.actorIds].sort()) {
    const visual = manifest.actorVisuals[actorId];
    if (visual?.["front"] && visual["back"]) continue;
    reporter.issue(ASSET_MANIFEST_SOURCE, "actorVisuals", "PRODUCTION_MISSING_ACTOR_VISUAL", `Actor "${actorId}" is reachable in the shipped Adventure but has no two-sided visual.`, actorId);
  }
  for (const equipmentId of [...reachable.equipmentIds].sort()) {
    if (manifest.equipmentVisuals[equipmentId]) continue;
    reporter.issue(ASSET_MANIFEST_SOURCE, "equipmentVisuals", "PRODUCTION_MISSING_EQUIPMENT_VISUAL", `Reachable equipment "${equipmentId}" has no visual.`, equipmentId);
  }
  for (const cardId of [...reachable.cardIds].sort()) {
    if (manifest.cardVisuals[cardId]) continue;
    reporter.issue(ASSET_MANIFEST_SOURCE, "cardVisuals", "PRODUCTION_MISSING_CARD_VISUAL", `Reachable card "${cardId}" has no visual.`, cardId);
  }
}

/** The release policy is QA configuration. Gameplay must not be able to read it. */
async function checkPolicyIsolation(reporter: Reporter): Promise<void> {
  const root = path.join(process.cwd(), "src");
  const offenders: string[] = [];
  const walk = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(entryPath);
        continue;
      }
      if (!entry.name.endsWith(".ts")) continue;
      if ((await readFile(entryPath, "utf8")).includes("m7-production-policy")) {
        offenders.push(path.relative(process.cwd(), entryPath));
      }
    }
  };
  await walk(root);
  for (const offender of offenders.sort()) {
    reporter.issue(offender, "imports", "POLICY_LEAKED_INTO_RUNTIME", `${offender} reads the release QA policy. Gameplay and runtime code must not depend on it.`);
  }
}

async function main(): Promise<void> {
  const pack = PRODUCTION_CONTENT.pack;
  const issues: ContentValidationIssue[] = [];
  const reporter = createReporter(issues, pack.manifest.id);

  checkIdentity(pack, reporter);
  const reachable = collectReachable(pack, reporter);
  const lists: readonly ReserveList[] = [
    {
      label: "card",
      field: "reserveCards",
      entries: M7_PRODUCTION_POLICY.reserveCards,
      known: new Set(Object.keys(pack.combatContent.cards)),
      reachable: reachable.cardIds,
    },
    {
      label: "equipment",
      field: "reserveEquipment",
      entries: M7_PRODUCTION_POLICY.reserveEquipment,
      known: new Set(Object.keys(pack.combatContent.equipment)),
      reachable: reachable.equipmentIds,
    },
    {
      label: "actor",
      field: "reserveActors",
      entries: M7_PRODUCTION_POLICY.reserveActors,
      known: new Set(Object.keys(pack.actorDefinitions)),
      reachable: reachable.actorIds,
    },
    {
      label: "scenario",
      field: "reserveScenarios",
      entries: M7_PRODUCTION_POLICY.reserveScenarios,
      known: new Set(Object.keys(pack.scenarioSources)),
      reachable: new Set(reachable.scenarios.map((scenario) => scenario.id)),
    },
  ];
  checkReserve(lists, reporter);
  checkOrphans(lists, reporter);
  checkVolume(pack, reachable, reporter);
  checkTutorialPrefix(reporter);
  checkStarterLoadouts(pack, reachable, reporter);
  checkPartySizeCoverage(pack, reachable, reporter);
  checkAiCoverage(pack, reachable, reporter);
  await checkVisualCoverage(reachable, reporter);
  await checkPolicyIsolation(reporter);

  if (issues.length > 0) {
    for (const issue of issues) process.stderr.write(`${formatContentValidationIssue(issue)}\n\n`);
    const plural = issues.length === 1 ? "violation" : "violations";
    process.stderr.write(`Production content FAILED: ${String(issues.length)} release policy ${plural}.\n`);
    process.exitCode = 1;
    return;
  }

  const reserved =
    M7_PRODUCTION_POLICY.reserveCards.length +
    M7_PRODUCTION_POLICY.reserveEquipment.length +
    M7_PRODUCTION_POLICY.reserveActors.length +
    M7_PRODUCTION_POLICY.reserveScenarios.length;
  process.stdout.write(
    `Production OK: ${pack.manifest.id}@${pack.manifest.version} ${pack.fingerprint}\n` +
      `  Adventure ${PRODUCTION_CONTENT.adventureId}: ${String(PRODUCTION_CONTENT.adventure.encounterIds.length)} encounters ` +
      `(${String(M7_PRODUCTION_POLICY.tutorialEncounterIds.length)} tutorial), buildable at ${PARTY_SIZES.map(String).join("P/")}P\n` +
      `  Reachable: ${String(reachable.starters.length)} starters, ${String(reachable.enemyIds.size)} enemies, ` +
      `${String(reachable.cardIds.size)} cards, ${String(reachable.equipmentIds.size)} equipment\n` +
      `  Reserved: ${String(reserved)} definitions, each with a reason and a follow-up\n`,
  );
}

await main();
