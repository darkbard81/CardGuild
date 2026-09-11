import type { AdventureDefinition } from "../../../../src/content";

/**
 * A three-Encounter Adventure with two rewards and an explicit 0 EXP for every battle:
 * these fixtures exercise the Adventure loop, not progression, and a silent award would
 * make every seeded expectation here depend on the production EXP table.
 */
export const CORE_ADVENTURES: readonly AdventureDefinition[] = [
  {
    id: "adventure.goblin-trouble",
    name: "Goblin Trouble",
    description: "길목의 매복을 뚫고 폐허의 문을 연 뒤 고블린 대장을 쓰러뜨리세요.",
    partySize: {
      min: 1,
      max: 3,
    },
    encounterIds: [
      "encounter.road-ambush",
      "encounter.ruined-gate",
      "encounter.goblin-chief",
    ],
    rewards: [
      {
        id: "reward.road-ambush",
        afterEncounterId: "encounter.road-ambush",
        choices: [
          {
            kind: "equipment",
            definitionId: "boots-of-fly",
          },
          {
            kind: "card",
            definitionId: "card.fly",
          },
        ],
      },
      {
        id: "reward.ruined-gate",
        afterEncounterId: "encounter.ruined-gate",
        choices: [
          {
            kind: "equipment",
            definitionId: "shield",
          },
          {
            kind: "card",
            definitionId: "card.spirit-beacon",
          },
        ],
      },
    ],
    experienceAwards: [
      {
        afterEncounterId: "encounter.road-ambush",
        amount: 0,
      },
      {
        afterEncounterId: "encounter.ruined-gate",
        amount: 0,
      },
      {
        afterEncounterId: "encounter.goblin-chief",
        amount: 0,
      },
    ],
  },
];
