/**
 * Release QA configuration for the authoritative M7 production pack.
 *
 * This is not gameplay content and not a runtime selector. Nothing under `src/`
 * may import it — `npm run content:production-check` fails if anything does.
 * The generic validator (`npm run content:check`) keeps owning what makes *any*
 * pack valid; this file only states what the *current* release ships, so the M3
 * and M6 regression fixtures are never measured against M7 volume targets.
 *
 * The design rationale lives in `docs/m7-encounter-matrix.md`,
 * `docs/m7-equipment-matrix.md`, `docs/m7-card-capability.md` and
 * `docs/m7-vertical-slice.md`. Those are written for people. CI reads this file,
 * so a release decision is never recovered by parsing Markdown.
 *
 * ## Reserve is tracked debt, not an exemption
 *
 * A reserve entry does not just switch off the orphan check for one ID. Each
 * entry has to name a reason and the issue that will settle it, has to point at
 * a definition the production pack really contains, and — this is what keeps the
 * list honest — has to *still be unreachable*. A reserve entry the Adventure has
 * since started using fails the gate as a stale entry, so the list cannot quietly
 * outlive its reason.
 *
 * Reserve also is not free. `reachableMinimum` below is a floor on what the
 * release actually puts in front of a player, and `volume` is a ceiling on what
 * the pack authors. Together they cap the reserve without a separate budget
 * number: moving one more card into reserve drops the reachable count under its
 * floor, so new reserve has to be paid for with new reachable content or with a
 * reviewed edit to the floor itself.
 */

/** One intentionally unreachable production definition. */
export interface ReserveEntry {
  /** A definition ID that the production pack really contains. */
  readonly id: string;
  /** Why the release ships it without a path to it. */
  readonly reason: string;
  /** The issue that decides whether it gets exposed or cut, as `#<number>`. */
  readonly followUp: string;
}

/** An inclusive count range the current release has to sit inside. */
export interface VolumeRange {
  readonly min: number;
  readonly max: number;
}

export const M7_PRODUCTION_POLICY = {
  /** The pack `PRODUCTION_CONTENT` is expected to select. */
  packId: "cardguild.m7",
  /** The single authoritative Adventure. */
  adventureId: "adventure.goblin-trouble",

  /**
   * The onboarding run, in order. These have to be the first encounters of the
   * authoritative Adventure — a prefix, not a set (`docs/m7-encounter-matrix.md` §4).
   */
  tutorialEncounterIds: [
    "encounter.road-ambush",
    "encounter.spear-line",
    "encounter.ruined-gate",
    "encounter.goblin-chief",
  ],

  /** How much content the M7 release authors. */
  volume: {
    starters: { min: 4, max: 4 },
    playerCards: { min: 24, max: 32 },
    enemies: { min: 15, max: 20 },
    scenarios: { min: 8, max: 12 },
    equipment: { min: 20, max: 30 },
    adventureEncounters: { min: 6, max: 8 },
    tutorialPrefix: { min: 3, max: 4 },
  },

  /**
   * How much of that content a player can actually reach. Set to what the
   * current release reaches, so growing the reserve lists without growing the
   * reachable pool fails the gate instead of hiding inside the volume ranges.
   */
  reachableMinimum: {
    playerCards: 21,
    equipment: 18,
    enemies: 13,
    scenarios: 8,
  },

  reserveCards: [
    {
      id: "card.vicious-swing",
      reason: "#13 Strike family. No starter prepares it and no reward offers it.",
      followUp: "#21",
    },
    {
      id: "card.aimed-shot",
      reason: "#13 ranged Strike. Needs a ranged weapon no starter carries.",
      followUp: "#21",
    },
    {
      id: "card.shield-press",
      reason: "Provided only by the spiked-shield `shield-spike` trait, itself reserved.",
      followUp: "#21",
    },
    {
      id: "card.dueling-parry",
      reason: "Provided only by the dueling-rapier `parry` trait, itself reserved.",
      followUp: "#21",
    },
    {
      id: "card.fear",
      reason: "#13 spell library. The four starters prepare none of it.",
      followUp: "#21",
    },
    {
      id: "card.harm",
      reason: "#13 spell library. The four starters prepare none of it.",
      followUp: "#21",
    },
    {
      id: "card.daze",
      reason: "#13 cantrip library. The four starters prepare none of it.",
      followUp: "#21",
    },
    {
      id: "card.telekinetic-projectile",
      reason: "#13 cantrip library. The four starters prepare none of it.",
      followUp: "#21",
    },
    {
      id: "card.ember-lash",
      reason: "#13 cantrip library. The four starters prepare none of it.",
      followUp: "#21",
    },
    {
      id: "card.force-barrage",
      reason: "#13 spell library. The four starters prepare none of it.",
      followUp: "#21",
    },
    {
      id: "card.spirit-edge",
      reason: "#13 ally buff. No starter prepares it and no reward offers it.",
      followUp: "#21",
    },
  ],

  reserveEquipment: [
    {
      id: "dueling-rapier",
      reason: "Defensive-duelist weapon. #19 left that build direction unexposed.",
      followUp: "#21",
    },
    {
      id: "boar-spear",
      reason: "#17 reward-grade weapon the six reward offers did not take.",
      followUp: "#21",
    },
    {
      id: "scout-leather",
      reason: "DEX-controller armor. #19 left that build direction unexposed.",
      followUp: "#21",
    },
    {
      id: "spiked-shield",
      reason: "#17 reward-grade shield the six reward offers did not take.",
      followUp: "#21",
    },
    {
      id: "executioner-axe",
      reason: "Advanced proficiency: no starter can attack with it (m7-equipment-matrix §5).",
      followUp: "#21",
    },
    {
      id: "brigandine",
      reason: "dexCap 0 medium armor, dominated by scale-mail for all four starters.",
      followUp: "#21",
    },
    {
      id: "bloodied-talisman",
      reason: "Cursed trade with no curse-removal lifecycle, so offering it is irreversible.",
      followUp: "#21",
    },
  ],

  reserveActors: [
    {
      id: "enemy.cave-spider",
      reason: "Placed only in encounter.web-hollow, a reserved Scenario.",
      followUp: "#21",
    },
    {
      id: "enemy.giant-spider",
      reason: "Placed only in encounter.web-hollow, a reserved Scenario.",
      followUp: "#21",
    },
    {
      id: "enemy.goblin-lackey",
      reason: "Placed only in encounter.collapsed-span, a reserved Scenario.",
      followUp: "#21",
    },
    {
      id: "enemy.goblin-slinger",
      reason: "Placed only in encounter.collapsed-span, a reserved Scenario.",
      followUp: "#21",
    },
    {
      id: "enemy.bone-hulk",
      reason: "Placed only in encounter.collapsed-span, a reserved Scenario.",
      followUp: "#21",
    },
  ],

  reserveScenarios: [
    {
      id: "encounter.web-hollow",
      reason: "Brute + skirmisher repeats the ruined-gate role axis, so #19 kept it out of the eight.",
      followUp: "#21",
    },
    {
      id: "encounter.collapsed-span",
      reason: "#16 reserve: the chasm splits the board and a melee-only party has no round one.",
      followUp: "#21",
    },
  ],
} as const satisfies {
  readonly packId: string;
  readonly adventureId: string;
  readonly tutorialEncounterIds: readonly string[];
  readonly volume: Readonly<Record<string, VolumeRange>>;
  readonly reachableMinimum: Readonly<Record<string, number>>;
  readonly reserveCards: readonly ReserveEntry[];
  readonly reserveEquipment: readonly ReserveEntry[];
  readonly reserveActors: readonly ReserveEntry[];
  readonly reserveScenarios: readonly ReserveEntry[];
};
