import type { AncestryDefinition, ClassDefinition } from "../../../src/character";
import type { TraitDefinition } from "../../../src/game";

/** Independent rule fixtures; never import a production release. */
export const BUILD_ANCESTRIES: readonly AncestryDefinition[] = [
  {
    "id": "dwarf",
    "hitPoints": 10,
    "speedFeet": 20,
    "fixedBoosts": [
      "con",
      "wis"
    ]
  },
  {
    "id": "elf",
    "hitPoints": 6,
    "speedFeet": 30,
    "fixedBoosts": [
      "dex",
      "int"
    ]
  },
  {
    "id": "human",
    "hitPoints": 8,
    "speedFeet": 25,
    "fixedBoosts": [
      "str",
      "wis"
    ]
  }
];
export const BUILD_CLASSES: readonly ClassDefinition[] = [
  {
    "id": "champion",
    "hpPerLevel": 10,
    "keyAttribute": "str",
    "starting": {
      "perception": "trained",
      "saves": {
        "fortitude": "expert",
        "reflex": "trained",
        "will": "expert"
      },
      "armor": {
        "unarmored": "trained",
        "light": "trained",
        "medium": "trained",
        "heavy": "trained"
      },
      "weapons": {
        "unarmed": "trained",
        "simple": "trained",
        "martial": "trained",
        "advanced": "untrained"
      },
      "classDc": "trained"
    },
    "milestones": [
      {
        "level": 5,
        "weapons": {
          "unarmed": "expert",
          "simple": "expert",
          "martial": "expert"
        }
      },
      {
        "level": 7,
        "armor": {
          "unarmored": "expert",
          "light": "expert",
          "medium": "expert",
          "heavy": "expert"
        }
      },
      {
        "level": 9,
        "classDc": "expert",
        "saves": {
          "reflex": "expert",
          "fortitude": "master"
        }
      },
      {
        "level": 11,
        "perception": "expert",
        "saves": {
          "will": "master"
        }
      },
      {
        "level": 13,
        "armor": {
          "unarmored": "master",
          "light": "master",
          "medium": "master",
          "heavy": "master"
        },
        "weapons": {
          "unarmed": "master",
          "simple": "master",
          "martial": "master"
        }
      },
      {
        "level": 17,
        "classDc": "master",
        "armor": {
          "unarmored": "legendary",
          "light": "legendary",
          "medium": "legendary",
          "heavy": "legendary"
        }
      }
    ]
  },
  {
    "id": "fighter",
    "hpPerLevel": 10,
    "keyAttribute": "str",
    "starting": {
      "perception": "expert",
      "saves": {
        "fortitude": "expert",
        "reflex": "expert",
        "will": "trained"
      },
      "armor": {
        "unarmored": "trained",
        "light": "trained",
        "medium": "trained",
        "heavy": "trained"
      },
      "weapons": {
        "unarmed": "expert",
        "simple": "expert",
        "martial": "expert",
        "advanced": "trained"
      },
      "classDc": "trained"
    },
    "milestones": [
      {
        "level": 3,
        "saves": {
          "will": "expert"
        }
      },
      {
        "level": 5,
        "weapons": {
          "unarmed": "master"
        }
      },
      {
        "level": 7,
        "perception": "master"
      },
      {
        "level": 9,
        "saves": {
          "fortitude": "master"
        }
      },
      {
        "level": 11,
        "armor": {
          "unarmored": "expert",
          "light": "expert",
          "medium": "expert",
          "heavy": "expert"
        },
        "classDc": "expert"
      },
      {
        "level": 13,
        "weapons": {
          "unarmed": "legendary",
          "simple": "master",
          "martial": "master",
          "advanced": "expert"
        }
      },
      {
        "level": 15,
        "saves": {
          "reflex": "master"
        }
      },
      {
        "level": 17,
        "armor": {
          "unarmored": "master",
          "light": "master",
          "medium": "master",
          "heavy": "master"
        }
      },
      {
        "level": 19,
        "weapons": {
          "simple": "legendary",
          "martial": "legendary",
          "advanced": "master"
        },
        "classDc": "master"
      }
    ]
  },
  {
    "id": "rogue",
    "hpPerLevel": 8,
    "keyAttribute": "dex",
    "starting": {
      "perception": "expert",
      "saves": {
        "fortitude": "trained",
        "reflex": "expert",
        "will": "expert"
      },
      "armor": {
        "unarmored": "trained",
        "light": "trained",
        "medium": "untrained",
        "heavy": "untrained"
      },
      "weapons": {
        "unarmed": "trained",
        "simple": "trained",
        "martial": "trained",
        "advanced": "untrained"
      },
      "classDc": "trained"
    },
    "milestones": [
      {
        "level": 5,
        "weapons": {
          "unarmed": "expert",
          "simple": "expert",
          "martial": "expert"
        }
      },
      {
        "level": 7,
        "saves": {
          "reflex": "master"
        },
        "perception": "master"
      },
      {
        "level": 9,
        "saves": {
          "fortitude": "expert"
        }
      },
      {
        "level": 11,
        "classDc": "expert"
      },
      {
        "level": 13,
        "saves": {
          "reflex": "legendary"
        },
        "perception": "legendary",
        "armor": {
          "unarmored": "expert",
          "light": "expert"
        },
        "weapons": {
          "unarmed": "master",
          "simple": "master",
          "martial": "master"
        }
      },
      {
        "level": 17,
        "saves": {
          "will": "master"
        }
      },
      {
        "level": 19,
        "classDc": "master",
        "armor": {
          "unarmored": "master",
          "light": "master"
        }
      }
    ]
  }
];
export const BUILD_TRAITS: readonly TraitDefinition[] = [
  {
    "id": "champion",
    "name": "Champion",
    "source": "pf2e-remaster",
    "category": "class",
    "description": "Champion 클래스입니다. 캐릭터의 생성 및 성장 규칙을 연결하는 정체성입니다.",
    "cardGrants": [],
    "actionGrants": []
  },
  {
    "id": "dwarf",
    "name": "Dwarf",
    "source": "pf2e-remaster",
    "category": "ancestry",
    "description": "Dwarf 종족입니다. 캐릭터의 생성 및 성장 규칙을 연결하는 정체성입니다.",
    "cardGrants": [],
    "actionGrants": []
  },
  {
    "id": "elf",
    "name": "Elf",
    "source": "pf2e-remaster",
    "category": "ancestry",
    "description": "Elf 종족입니다. 캐릭터의 생성 및 성장 규칙을 연결하는 정체성입니다.",
    "cardGrants": [],
    "actionGrants": []
  },
  {
    "id": "fighter",
    "name": "Fighter",
    "source": "pf2e-remaster",
    "category": "class",
    "description": "Fighter 클래스입니다. 캐릭터의 생성 및 성장 규칙을 연결하는 정체성입니다.",
    "cardGrants": [],
    "actionGrants": []
  },
  {
    "id": "human",
    "name": "Human",
    "source": "pf2e-remaster",
    "category": "ancestry",
    "description": "Human 종족입니다. 캐릭터의 생성 및 성장 규칙을 연결하는 정체성입니다.",
    "cardGrants": [],
    "actionGrants": []
  },
  {
    "id": "rogue",
    "name": "Rogue",
    "source": "pf2e-remaster",
    "category": "class",
    "description": "Rogue 클래스입니다. 캐릭터의 생성 및 성장 규칙을 연결하는 정체성입니다.",
    "cardGrants": [],
    "actionGrants": []
  }
];
