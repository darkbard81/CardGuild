/**
 * The character rules, written as what they add to the core rules.
 *
 * The two fixtures share one battlefield, one Action set and one equipment vocabulary on
 * purpose: a test that fails under both is failing on a rule, and a test that fails under
 * only one is failing on the thing this file adds. Writing the second fixture as a diff is
 * what keeps that true — a second full copy would drift until the difference meant nothing.
 */
import type {
  ActionDefinition,
  CardDefinition,
  EquipmentDefinition,
  TraitDefinition,
} from "../../../src/game";
import type { ActorDefinition, AdventureDefinition, ContentPackSource } from "../../../src/content";
import { CORE_ACTIONS } from "./core/actions";
import { CORE_ACTORS } from "./core/actors";
import { CORE_ADVENTURES } from "./core/adventure";
import { CORE_CARDS } from "./core/cards";
import { CORE_EQUIPMENT } from "./core/equipment";
import { CORE_TRAITS } from "./core/traits";

/**
 * The vocabulary the character rules need on top of the core Traits: which Characters a
 * player may pick, and the weapon and spell categories the resolver reads.
 */
const CHARACTER_RULES_TRAITS: readonly TraitDefinition[] = [
  {
    id: "playable",
    name: "Playable Character",
    source: "cardguild",
    category: "system",
    description: "플레이어가 고를 수 있는 캐릭터를 표시하는 CardGuild 시스템 표식입니다.",
    cardGrants: [],
    actionGrants: [],
  },
  {
    id: "propulsive",
    name: "Propulsive",
    source: "pf2e-remaster",
    category: "weapon",
    description: "추진력 무기입니다. 원거리 피해에 STR 수정치의 절반(음수면 전부)을 더합니다.",
    cardGrants: [],
    actionGrants: [],
  },
  {
    id: "spell",
    name: "Spell",
    source: "cardguild",
    category: "action",
    description: "주문입니다. 주문 카드와 행동을 표시하는 CardGuild 분류입니다.",
    cardGrants: [],
    actionGrants: [],
  },
  {
    id: "thrown",
    name: "Thrown",
    source: "pf2e-remaster",
    category: "weapon",
    description: "던지는 무기입니다. 원거리 공격이지만 피해에 STR 수정치를 더합니다.",
    cardGrants: [],
    actionGrants: [],
  },
];
/**
 * One more Action, so a spell is not the only member of its own category.
 */
const CHARACTER_RULES_ACTIONS: readonly ActionDefinition[] = [
  {
    id: "spirit-lance",
    name: "Spirit Lance",
    description: "영적 통찰로 아르카나 지식을 벼려 쏘아 보냅니다. 대상이 Reflex로 저항합니다.",
    timing: {
      kind: "turn",
      actions: 1,
    },
    traits: [
      {
        id: "concentrate",
      },
      {
        id: "focus",
      },
      {
        id: "spell",
      },
    ],
    targeting: "enemy",
    range: {
      kind: "feet",
      value: 30,
    },
    resolution: {
      kind: "check",
      check: {
        roller: "target",
        statistic: {
          kind: "save",
          save: "reflex",
        },
        dc: {
          kind: "statistic-dc",
          owner: "actor",
          statistic: {
            kind: "skill",
            skill: "arcana",
            attributeOverride: "wis",
          },
        },
      },
      outcomes: {
        "critical-success": [],
        success: [
          {
            kind: "damage",
            owner: "target",
            dice: {
              count: 1,
              sides: 4,
            },
            flatModifier: 0,
            damageType: "force",
          },
        ],
        failure: [
          {
            kind: "damage",
            owner: "target",
            dice: {
              count: 2,
              sides: 4,
            },
            flatModifier: 0,
            damageType: "force",
          },
        ],
        "critical-failure": [
          {
            kind: "damage",
            owner: "target",
            dice: {
              count: 2,
              sides: 4,
            },
            flatModifier: 0,
            multiplier: 2,
            damageType: "force",
          },
          {
            kind: "apply-condition",
            owner: "target",
            condition: "prone",
          },
        ],
      },
    },
  },
];
/**
 * The card that carries the added Action into a hand.
 */
const CHARACTER_RULES_CARDS: readonly CardDefinition[] = [
  {
    id: "card.spirit-lance",
    name: "Spirit Lance",
    actionId: "spirit-lance",
    traits: [
      {
        id: "spell",
      },
      {
        id: "focus",
      },
      {
        id: "concentrate",
      },
    ],
  },
];
/**
 * Armor across the three categories and weapons across the three attack modes, which is
 * what makes the derived Armor Class and Strike numbers worth asserting.
 */
const CHARACTER_RULES_EQUIPMENT: readonly EquipmentDefinition[] = [
  {
    id: "leather-armor",
    name: "Leather Armor",
    slot: "armor",
    traits: [],
    statModifiers: [],
    armorProfile: {
      category: "light",
      acItemBonus: 1,
      dexCap: 4,
    },
  },
  {
    id: "scale-mail",
    name: "Scale Mail",
    slot: "armor",
    traits: [],
    statModifiers: [],
    armorProfile: {
      category: "medium",
      acItemBonus: 3,
      dexCap: 2,
    },
  },
  {
    id: "half-plate",
    name: "Half Plate",
    slot: "armor",
    traits: [],
    statModifiers: [],
    armorProfile: {
      category: "heavy",
      acItemBonus: 5,
      dexCap: 1,
    },
  },
  {
    id: "light-blade",
    name: "Light Blade",
    slot: "weapon",
    traits: [
      {
        id: "weapon",
      },
      {
        id: "agile",
      },
      {
        id: "finesse",
      },
    ],
    statModifiers: [],
    weaponProfile: {
      name: "Light Blade",
      category: "martial",
      attackMode: "melee",
      rangeFeet: 5,
      damage: {
        count: 1,
        sides: 6,
        damageType: "slashing",
      },
      traits: [],
    },
  },
  {
    id: "guardian-mace",
    name: "Guardian Mace",
    slot: "weapon",
    traits: [
      {
        id: "weapon",
      },
    ],
    statModifiers: [],
    weaponProfile: {
      name: "Guardian Mace",
      category: "martial",
      attackMode: "melee",
      rangeFeet: 5,
      damage: {
        count: 1,
        sides: 8,
        damageType: "bludgeoning",
      },
      traits: [],
    },
  },
  {
    id: "composite-shortbow",
    name: "Composite Shortbow",
    slot: "weapon",
    traits: [
      {
        id: "weapon",
      },
      {
        id: "propulsive",
      },
    ],
    statModifiers: [],
    weaponProfile: {
      name: "Composite Shortbow",
      category: "martial",
      attackMode: "ranged",
      rangeFeet: 60,
      damage: {
        count: 1,
        sides: 6,
        damageType: "piercing",
      },
      traits: [],
    },
  },
];
/**
 * The other two playable Characters. Together with the core hero they cover the three
 * builds the loadout and progression rules are written for.
 */
const CHARACTER_RULES_ACTORS: readonly ActorDefinition[] = [
  {
    id: "hero.lyra",
    name: "Lyra",
    statProfile: {
      kind: "character",
      stats: {
        level: 1,
        attributes: {
          str: 2,
          dex: 4,
          con: 1,
          int: 2,
          wis: 3,
          cha: 2,
        },
        perception: "expert",
        saves: {
          fortitude: "trained",
          reflex: "trained",
          will: "trained",
        },
        skills: {
          acrobatics: "expert",
          arcana: "trained",
          athletics: "trained",
          crafting: "trained",
          deception: "trained",
          diplomacy: "trained",
          intimidation: "untrained",
          medicine: "trained",
          nature: "trained",
          occultism: "trained",
          performance: "trained",
          religion: "untrained",
          society: "trained",
          stealth: "expert",
          survival: "trained",
          thievery: "trained",
        },
        defense: {
          ancestryHp: 6,
          classHpPerLevel: 8,
          armorProficiencies: {
            unarmored: "trained",
            light: "trained",
            medium: "untrained",
            heavy: "untrained",
          },
        },
        offense: {
          keyAttribute: "dex",
          weaponProficiencies: {
            unarmed: "trained",
            simple: "trained",
            martial: "trained",
            advanced: "untrained",
          },
          classDcProficiency: "trained",
          unarmedStrike: {
            name: "Fist",
            category: "unarmed",
            attackMode: "melee",
            rangeFeet: 5,
            damage: {
              count: 1,
              sides: 4,
              damageType: "bludgeoning",
            },
            traits: [
              {
                id: "agile",
              },
              {
                id: "finesse",
              },
            ],
          },
        },
      },
    },
    speedFeet: 30,
    initialConditions: [],
    traits: [
      {
        id: "actor",
      },
      {
        id: "hero",
      },
      {
        id: "playable",
      },
    ],
    loadoutProfile: {
      preparedCardCapacity: 2,
    },
    starterLoadout: {
      equipment: {
        weapon: "light-blade",
        armor: "leather-armor",
        feet: "boots-of-fly",
      },
      preparedCards: [],
    },
    innateActionIds: [],
    baseCardGrants: [
      {
        cardDefinitionId: "card.spirit-beacon",
        count: 1,
        sourceId: "focus.wind-beacon",
      },
    ],
  },
  {
    id: "hero.brom",
    name: "Brom",
    statProfile: {
      kind: "character",
      stats: {
        level: 1,
        attributes: {
          str: 3,
          dex: 0,
          con: 4,
          int: 0,
          wis: -1,
          cha: 1,
        },
        perception: "trained",
        saves: {
          fortitude: "expert",
          reflex: "trained",
          will: "trained",
        },
        skills: {
          acrobatics: "untrained",
          arcana: "untrained",
          athletics: "master",
          crafting: "trained",
          deception: "untrained",
          diplomacy: "untrained",
          intimidation: "trained",
          medicine: "trained",
          nature: "untrained",
          occultism: "untrained",
          performance: "untrained",
          religion: "trained",
          society: "untrained",
          stealth: "untrained",
          survival: "trained",
          thievery: "untrained",
        },
        defense: {
          ancestryHp: 10,
          classHpPerLevel: 12,
          armorProficiencies: {
            unarmored: "trained",
            light: "trained",
            medium: "trained",
            heavy: "expert",
          },
        },
        offense: {
          keyAttribute: "str",
          weaponProficiencies: {
            unarmed: "trained",
            simple: "trained",
            martial: "trained",
            advanced: "untrained",
          },
          classDcProficiency: "trained",
          unarmedStrike: {
            name: "Fist",
            category: "unarmed",
            attackMode: "melee",
            rangeFeet: 5,
            damage: {
              count: 1,
              sides: 4,
              damageType: "bludgeoning",
            },
            traits: [
              {
                id: "agile",
              },
              {
                id: "finesse",
              },
            ],
          },
        },
      },
    },
    speedFeet: 20,
    initialConditions: [],
    traits: [
      {
        id: "actor",
      },
      {
        id: "hero",
      },
      {
        id: "playable",
      },
    ],
    loadoutProfile: {
      preparedCardCapacity: 2,
    },
    starterLoadout: {
      equipment: {
        weapon: "guardian-mace",
        armor: "half-plate",
        shield: "shield",
      },
      preparedCards: [],
    },
    innateActionIds: [],
    baseCardGrants: [
      {
        cardDefinitionId: "card.reactive-strike",
        count: 2,
        sourceId: "feat.guardian-sentinel",
      },
    ],
  },
];

/**
 * Apply one addition to the entry `id` names, leaving every other entry alone.
 *
 * Overrides are spelled out as edits rather than as replacement copies so the difference
 * between the two fixtures stays readable in one place: three edits, each with a reason.
 */
function override<T extends { readonly id: string }>(
  entries: readonly T[],
  id: string,
  edit: (entry: T) => T,
): readonly T[] {
  const found = entries.some((entry) => entry.id === id);
  if (!found) throw new Error(`Character rules override targets missing entry "${id}".`);
  return entries.map((entry) => (entry.id === id ? edit(entry) : entry));
}

/**
 * The hero the core rules share, made pickable and given body armor.
 *
 * `playable` is what the party builder filters on, and the armor is what makes this hero's
 * Armor Class come from an item rather than from Dexterity alone — the two facts the
 * character rules exist to test.
 */
const CHARACTER_RULES_HERO_ACTORS: readonly ActorDefinition[] = override(
  [...CORE_ACTORS, ...CHARACTER_RULES_ACTORS],
  "hero.aerin",
  (actor) => ({
    ...actor,
    traits: [...actor.traits, { id: "playable" }],
    starterLoadout: {
      ...actor.starterLoadout,
      equipment: { ...actor.starterLoadout.equipment, armor: "scale-mail" },
    },
  }),
);

/** The focus Action becomes a spell, which is what the spell rules key off. */
const CHARACTER_RULES_ALL_ACTIONS: readonly ActionDefinition[] = override(
  [...CORE_ACTIONS, ...CHARACTER_RULES_ACTIONS],
  "spirit-beacon",
  (action) => ({ ...action, traits: [...action.traits, { id: "spell" }] }),
);

/**
 * The second reward offers the added card instead of the core one.
 *
 * A reward the party can only get here is how the loadout tests tell "granted by this
 * Adventure" apart from "carried in from the start".
 */
const CHARACTER_RULES_ADVENTURES: readonly AdventureDefinition[] = CORE_ADVENTURES.map((adventure) => ({
  ...adventure,
  rewards: adventure.rewards.map((reward) => (reward.afterEncounterId === "encounter.ruined-gate"
    ? {
        ...reward,
        choices: reward.choices.map((choice) => (choice.kind === "card" && choice.definitionId === "card.spirit-beacon"
          ? { ...choice, definitionId: "card.spirit-lance" }
          : choice)),
      }
    : reward)),
}));

/** Everything the character rules add or change, as the pieces a source pack is built from. */
export const CHARACTER_RULES_DEFINITIONS = {
  traits: [...CORE_TRAITS, ...CHARACTER_RULES_TRAITS],
  actions: CHARACTER_RULES_ALL_ACTIONS,
  cards: [...CORE_CARDS, ...CHARACTER_RULES_CARDS],
  equipment: [...CORE_EQUIPMENT, ...CHARACTER_RULES_EQUIPMENT],
  actors: CHARACTER_RULES_HERO_ACTORS,
  adventures: CHARACTER_RULES_ADVENTURES,
} as const satisfies Partial<ContentPackSource>;
