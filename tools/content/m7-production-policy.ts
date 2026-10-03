/**
 * Release QA configuration for the authoritative M7 production pack.
 *
 * Authored campaigns are registered separately in content/m7/campaign.json.
 * Reserve lists and reachable floors below describe this protected campaign.
 * This is not gameplay content and not a runtime selector. Nothing under `src/`
 * may import it — `check-production-content.ts` fails if anything does.
 * The generic validator (`check-content.ts`) keeps owning what makes *any*
 * pack valid; this file only states what the *current* release ships, so the M3
 * and M6 regression fixtures are never measured against M7 release targets.
 *
 * The design rationale lives in issues #15-#17 and #19 and in the commits that
 * set these numbers. Those are written for people. CI reads this file, so a
 * release decision is never recovered by parsing Markdown.
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
 * `reachableMinimum` below is what stops the reserve lists from shrinking the
 * release: moving a definition a player can currently get to into reserve drops
 * the reachable count under its floor, so that move costs a reviewed edit to the
 * floor itself. It is not a reserve budget. Authoring *new* content straight into
 * reserve leaves the reachable counts alone and requires review of the list
 * itself: explicit,
 * reviewable, stale-detectable entries rather than a wildcard exemption.
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

export const M7_PRODUCTION_POLICY = {
  /** The pack `PRODUCTION_CONTENT` is expected to select. */
  packId: "cardguild.m7",
  /** Protected campaign: its release promises remain checked even when an authored campaign is selected. */
  adventureId: "adventure.willowbrook",
  /** Authored recruitment integration slice; not a selectable production start. Cutover is #67. */
  stagedAdventureIds: ["adventure.recruitment-tutorial", "adventure.goblin-trouble"],

  /**
   * The onboarding run, in order. These have to be the first encounters of the
   * authoritative Adventure — a prefix, not a set (#16). A party that meets these
   * out of order meets them without the vocabulary the earlier ones teach.
   */
  tutorialEncounterIds: [
    "encounter.guild-practice",
    "encounter.prone-training",
    "encounter.flanking-training",
    "encounter.knowledge-training",
  ],

  /**
   * Chapter 1 ends at level 1 after four protected tutorials and four field encounters.
   */
  levelMilestones: { "8": 1 },

  /** Explicit launch roster; rules-registry additions do not automatically become selectable. */
  creationClasses: ["bard", "champion", "cleric", "druid", "fighter", "ranger", "rogue", "witch", "wizard"],

  /**
   * How much of that content a player can actually get to: what the four starters
   * walk in with, and what the Adventure hands out. Set to what the current release
   * reaches, so retiring reachable content into reserve fails the gate instead of
   * silently reducing the playable release. #21 raised these when a fourth choice on each
   * reward offer opened the last two #17 build directions.
   */
  reachableMinimum: {
    playerCards: 20,
    equipment: 11,
    enemies: 5,
    scenarios: 8,
  },

  reserveCards: [
    {"id": "card.arcane-ward", "reason": "Preserved legacy expedition content; the selected release ends after four Willowbrook encounters at level 1.", "followUp": "#62"},
    {"id": "card.battle-medicine", "reason": "Preserved legacy expedition content; the selected release ends after four Willowbrook encounters at level 1.", "followUp": "#62"},
    {"id": "card.combat-grab", "reason": "Preserved legacy expedition content; the selected release ends after four Willowbrook encounters at level 1.", "followUp": "#62"},
    {"id": "card.demoralize", "reason": "Preserved legacy expedition content; the selected release ends after four Willowbrook encounters at level 1.", "followUp": "#62"},
    {"id": "card.dueling-parry", "reason": "Preserved legacy expedition content; the selected release ends after four Willowbrook encounters at level 1.", "followUp": "#62"},
    {"id": "card.fly", "reason": "Preserved legacy expedition content; the selected release ends after four Willowbrook encounters at level 1.", "followUp": "#62"},
    {"id": "card.grapple", "reason": "Preserved legacy expedition content; the selected release ends after four Willowbrook encounters at level 1.", "followUp": "#62"},
    {"id": "card.harm", "reason": "Preserved legacy expedition content; the selected release ends after four Willowbrook encounters at level 1.", "followUp": "#62"},
    {"id": "card.hover-step", "reason": "Preserved legacy expedition content; the selected release ends after four Willowbrook encounters at level 1.", "followUp": "#62"},
    {"id": "card.iron-presence", "reason": "Preserved legacy expedition content; the selected release ends after four Willowbrook encounters at level 1.", "followUp": "#62"},
    {"id": "card.reactive-strike", "reason": "Preserved legacy expedition content; the selected release ends after four Willowbrook encounters at level 1.", "followUp": "#62"},
    {"id": "card.shield-press", "reason": "Preserved legacy expedition content; the selected release ends after four Willowbrook encounters at level 1.", "followUp": "#62"},
    {"id": "card.slip-free", "reason": "Preserved legacy expedition content; the selected release ends after four Willowbrook encounters at level 1.", "followUp": "#62"},
    {"id": "card.spirit-beacon", "reason": "Preserved legacy expedition content; the selected release ends after four Willowbrook encounters at level 1.", "followUp": "#62"},
    {"id": "card.spirit-lance", "reason": "Preserved legacy expedition content; the selected release ends after four Willowbrook encounters at level 1.", "followUp": "#62"},
    { id: "card.intimidating-strike", reason: "Level 2 capability removed from the level 1 starter; no current reward offers it.", followUp: "#21" },
    { id: "card.knockdown", reason: "Level 4 Slam Down capability removed from the level 1 starter; outside this Adventure progression.", followUp: "#21" },
    {
      id: "card.ember-lash",
      reason: "#13 cantrip library. The four starters prepare none of it.",
      followUp: "#21",
    },
    {
      id: "card.spirit-edge",
      reason: "#13 ally buff. No starter prepares it and no reward offers it.",
      followUp: "#21",
    },
  ],

  reserveEquipment: [
    {"id": "boots-of-fly", "reason": "Preserved legacy expedition content; the selected release ends after four Willowbrook encounters at level 1.", "followUp": "#62"},
    {"id": "buckler", "reason": "Preserved legacy expedition content; the selected release ends after four Willowbrook encounters at level 1.", "followUp": "#62"},
    {"id": "dueling-rapier", "reason": "Preserved legacy expedition content; the selected release ends after four Willowbrook encounters at level 1.", "followUp": "#62"},
    {"id": "flick-mace", "reason": "Preserved legacy expedition content; the selected release ends after four Willowbrook encounters at level 1.", "followUp": "#62"},
    {"id": "greatsword", "reason": "Preserved legacy expedition content; the selected release ends after four Willowbrook encounters at level 1.", "followUp": "#62"},
    {"id": "hexers-focus", "reason": "Preserved legacy expedition content; the selected release ends after four Willowbrook encounters at level 1.", "followUp": "#62"},
    {"id": "medics-kit", "reason": "Preserved legacy expedition content; the selected release ends after four Willowbrook encounters at level 1.", "followUp": "#62"},
    {"id": "scout-leather", "reason": "Preserved legacy expedition content; the selected release ends after four Willowbrook encounters at level 1.", "followUp": "#62"},
    {"id": "spiked-shield", "reason": "Preserved legacy expedition content; the selected release ends after four Willowbrook encounters at level 1.", "followUp": "#62"},
    {"id": "striders-boots", "reason": "Preserved legacy expedition content; the selected release ends after four Willowbrook encounters at level 1.", "followUp": "#62"},
    {"id": "throwing-axes", "reason": "Preserved legacy expedition content; the selected release ends after four Willowbrook encounters at level 1.", "followUp": "#62"},
    {"id": "tower-shield", "reason": "Preserved legacy expedition content; the selected release ends after four Willowbrook encounters at level 1.", "followUp": "#62"},
    {"id": "warding-charm", "reason": "Preserved legacy expedition content; the selected release ends after four Willowbrook encounters at level 1.", "followUp": "#62"},
    {
      id: "boar-spear",
      reason: "#17 reward-grade weapon the six reward offers did not take.",
      followUp: "#21",
    },
    {
      id: "executioner-axe",
      reason:
        "Advanced weapon. Every starter is untrained in it, so the Strike is legal but loses 3 to 5 " +
        "attack: a build-gated hold for later proficiency, not an unusable item (m7-equipment-matrix §5).",
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
    {"id": "enemy.bone-priest", "reason": "Preserved legacy expedition content; the selected release ends after four Willowbrook encounters at level 1.", "followUp": "#62"},
    {"id": "enemy.cult-firebrand", "reason": "Preserved legacy expedition content; the selected release ends after four Willowbrook encounters at level 1.", "followUp": "#62"},
    {"id": "enemy.cult-hierophant", "reason": "Preserved legacy expedition content; the selected release ends after four Willowbrook encounters at level 1.", "followUp": "#62"},
    {"id": "enemy.cult-initiate", "reason": "Preserved legacy expedition content; the selected release ends after four Willowbrook encounters at level 1.", "followUp": "#62"},
    {"id": "enemy.dire-wolf", "reason": "Preserved legacy expedition content; the selected release ends after four Willowbrook encounters at level 1.", "followUp": "#62"},
    {"id": "enemy.goblin-brute", "reason": "Preserved legacy expedition content; the selected release ends after four Willowbrook encounters at level 1.", "followUp": "#62"},
    {"id": "enemy.goblin-chief", "reason": "Preserved legacy expedition content; the selected release ends after four Willowbrook encounters at level 1.", "followUp": "#62"},
    {"id": "enemy.goblin-skirmisher", "reason": "Preserved legacy expedition content; the selected release ends after four Willowbrook encounters at level 1.", "followUp": "#62"},
    {"id": "enemy.goblin-spearman", "reason": "Preserved legacy expedition content; the selected release ends after four Willowbrook encounters at level 1.", "followUp": "#62"},
    {"id": "enemy.skeleton-archer", "reason": "Preserved legacy expedition content; the selected release ends after four Willowbrook encounters at level 1.", "followUp": "#62"},
    {"id": "enemy.skeleton-guard", "reason": "Preserved legacy expedition content; the selected release ends after four Willowbrook encounters at level 1.", "followUp": "#62"},
    {"id": "enemy.skeleton-rabble", "reason": "Preserved legacy expedition content; the selected release ends after four Willowbrook encounters at level 1.", "followUp": "#62"},
    {"id": "enemy.wolf-yearling", "reason": "Preserved legacy expedition content; the selected release ends after four Willowbrook encounters at level 1.", "followUp": "#62"},
    { id: "enemy.slime-trainee", reason: "Android now hosts all four guild training encounters; former practice enemy retained as reserve.", followUp: "#70" },
    { id: "enemy.goblin-lackey", reason: "The first production encounter now uses the protected Android practice; retained for the staged recruitment slice.", followUp: "#67" },
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
    {"id": "encounter.archer-perch", "reason": "Preserved legacy expedition content; the selected release ends after four Willowbrook encounters at level 1.", "followUp": "#62"},
    {"id": "encounter.bone-cellar", "reason": "Preserved legacy expedition content; the selected release ends after four Willowbrook encounters at level 1.", "followUp": "#62"},
    {"id": "encounter.cult-sanctum", "reason": "Preserved legacy expedition content; the selected release ends after four Willowbrook encounters at level 1.", "followUp": "#62"},
    {"id": "encounter.goblin-chief", "reason": "Preserved legacy expedition content; the selected release ends after four Willowbrook encounters at level 1.", "followUp": "#62"},
    {"id": "encounter.ruined-gate", "reason": "Preserved legacy expedition content; the selected release ends after four Willowbrook encounters at level 1.", "followUp": "#62"},
    {"id": "encounter.spear-line", "reason": "Preserved legacy expedition content; the selected release ends after four Willowbrook encounters at level 1.", "followUp": "#62"},
    {"id": "encounter.wolf-run", "reason": "Preserved legacy expedition content; the selected release ends after four Willowbrook encounters at level 1.", "followUp": "#62"},
    { id: "encounter.road-ambush", reason: "Replaced by guild practice at production entry; retained for the staged recruitment slice until full Tutorial cutover.", followUp: "#67" },
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
  readonly creationClasses: readonly string[];
  readonly packId: string;
  readonly adventureId: string;
  readonly stagedAdventureIds: readonly string[];
  readonly tutorialEncounterIds: readonly string[];
  readonly levelMilestones: Readonly<Record<string, number>>;
  readonly reachableMinimum: Readonly<Record<string, number>>;
  readonly reserveCards: readonly ReserveEntry[];
  readonly reserveEquipment: readonly ReserveEntry[];
  readonly reserveActors: readonly ReserveEntry[];
  readonly reserveScenarios: readonly ReserveEntry[];
};
