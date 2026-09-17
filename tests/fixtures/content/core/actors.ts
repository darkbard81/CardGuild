import type { ActorSource } from "../../../../src/content";

/** Legal Character build sources and fixed Creature opponents. */
export const CORE_ACTORS: readonly ActorSource[] = [
  {
    "id": "hero.aerin",
    "name": "Aerin",
    "statProfile": {
      "kind": "character",
      "build": {
        "freeBoosts": [
          "str",
          "dex",
          "con",
          "int"
        ],
        "trainedSkills": [
          "athletics",
          "arcana",
          "intimidation"
        ]
      },
      "level": 1,
      "advancements": []
    },
    "initialConditions": [],
    "traits": [
      {
        "id": "actor"
      },
      {
        "id": "hero"
      },
      {
        "id": "human"
      },
      {
        "id": "fighter"
      }
    ],
    "loadoutProfile": {
      "preparedCardCapacity": 2
    },
    "starterLoadout": {
      "equipment": {
        "weapon": "halberd",
        "shield": "shield",
        "feet": "boots-of-fly"
      },
      "preparedCards": []
    },
    "innateActionIds": [],
    "baseCardGrants": [
      {
        "cardDefinitionId": "card.spirit-beacon",
        "count": 2,
        "sourceId": "focus.spirit-beacon"
      },
      {
        "cardDefinitionId": "card.reactive-strike",
        "count": 1,
        "sourceId": "feat.reactive-strike"
      }
    ]
  },
  {
    "id": "enemy.goblin-skirmisher",
    "name": "Goblin Skirmisher",
    "statProfile": {
      "kind": "creature",
      "stats": {
        "ac": 16,
        "maxHp": 18,
        "strike": {
          "name": "Goblin Blade",
          "attackModifier": 6,
          "rangeFeet": 5,
          "damage": {
            "count": 1,
            "sides": 6,
            "modifier": 2,
            "damageType": "slashing"
          },
          "traits": []
        },
        "perception": 5,
        "saves": {
          "fortitude": 3,
          "reflex": 5,
          "will": 2
        },
        "skills": {
          "athletics": 4,
          "stealth": 7
        }
      }
    },
    "speedFeet": 25,
    "initialConditions": [],
    "traits": [
      {
        "id": "actor"
      },
      {
        "id": "goblin"
      }
    ],
    "loadoutProfile": {
      "preparedCardCapacity": 0
    },
    "starterLoadout": {
      "equipment": {},
      "preparedCards": []
    },
    "innateActionIds": [],
    "baseCardGrants": []
  },
  {
    "id": "enemy.goblin-brute",
    "name": "Goblin Brute",
    "statProfile": {
      "kind": "creature",
      "stats": {
        "ac": 17,
        "maxHp": 24,
        "strike": {
          "name": "Heavy Club",
          "attackModifier": 7,
          "rangeFeet": 5,
          "damage": {
            "count": 1,
            "sides": 8,
            "modifier": 3,
            "damageType": "bludgeoning"
          },
          "traits": []
        },
        "perception": 3,
        "saves": {
          "fortitude": 7,
          "reflex": 3,
          "will": 4
        },
        "skills": {
          "athletics": 7
        }
      }
    },
    "speedFeet": 20,
    "initialConditions": [],
    "traits": [
      {
        "id": "actor"
      },
      {
        "id": "goblin"
      }
    ],
    "loadoutProfile": {
      "preparedCardCapacity": 0
    },
    "starterLoadout": {
      "equipment": {},
      "preparedCards": []
    },
    "innateActionIds": [
      "knockdown"
    ],
    "baseCardGrants": []
  },
  {
    "id": "enemy.goblin-chief",
    "name": "Goblin Chief",
    "statProfile": {
      "kind": "creature",
      "stats": {
        "ac": 18,
        "maxHp": 34,
        "strike": {
          "name": "Chief's Glaive",
          "attackModifier": 9,
          "rangeFeet": 10,
          "damage": {
            "count": 1,
            "sides": 10,
            "modifier": 4,
            "damageType": "slashing"
          },
          "traits": []
        },
        "perception": 6,
        "saves": {
          "fortitude": 8,
          "reflex": 5,
          "will": 6
        },
        "skills": {
          "athletics": 8,
          "intimidation": 8
        }
      }
    },
    "speedFeet": 25,
    "initialConditions": [],
    "traits": [
      {
        "id": "actor"
      },
      {
        "id": "goblin"
      }
    ],
    "loadoutProfile": {
      "preparedCardCapacity": 0
    },
    "starterLoadout": {
      "equipment": {},
      "preparedCards": []
    },
    "innateActionIds": [
      "knockdown"
    ],
    "baseCardGrants": []
  }
];
