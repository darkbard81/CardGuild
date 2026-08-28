import { positionKey } from "./grid";
import type {
  ActionDefinition,
  ActorSetup,
  BattleMapState,
  CardDefinition,
  CombatContent,
  EquipmentDefinition,
  GridPosition,
  ScenarioDefinition,
  TileState,
  TraitInstance,
  TraitDefinition,
  ConditionDefinition,
} from "./types";

export const M0_DEFAULT_SEED = 1;

const trait = (id: string, sourceId?: string): TraitInstance => ({ id, sourceId });

const actions: readonly ActionDefinition[] = [
  {
    id: "step",
    name: "Step",
    description: "인접한 Open 칸으로 5ft 이동하고 바라볼 방향을 정합니다.",
    timing: { kind: "turn", actions: 1 },
    traits: [trait("move")],
    targeting: "tile",
    effect: { kind: "move", movementMode: "land", step: true, triggersReactions: false },
  },
  {
    id: "stride",
    name: "Stride",
    description: "Speed 범위에서 직교 경로로 이동하고 바라볼 방향을 정합니다.",
    timing: { kind: "turn", actions: 1 },
    traits: [trait("move")],
    targeting: "tile",
    effect: { kind: "move", movementMode: "land", step: false, triggersReactions: true },
  },
  {
    id: "strike",
    name: "Strike",
    description: "장착 무기의 공격 수치와 피해를 사용하는 기본 공격입니다.",
    timing: { kind: "turn", actions: 1 },
    traits: [trait("attack")],
    targeting: "enemy",
    effect: { kind: "weapon-attack", damageMultiplier: 1 },
  },
  {
    id: "stand",
    name: "Stand",
    description: "Prone 상태를 제거합니다.",
    timing: { kind: "turn", actions: 1 },
    traits: [trait("move")],
    targeting: "self",
    effect: { kind: "remove-condition", condition: "prone" },
  },
  {
    id: "escape-grab",
    name: "Escape Grab",
    description: "Athletics 판정으로 Grabbed 상태를 제거합니다.",
    timing: { kind: "turn", actions: 1 },
    traits: [trait("attack")],
    targeting: "self",
    effect: {
      kind: "recovery-check",
      condition: "grabbed",
      modifier: "athletics",
      dc: 15,
      outcomes: {
        "critical-success": [{ kind: "remove-condition", condition: "grabbed" }],
        success: [{ kind: "remove-condition", condition: "grabbed" }],
        failure: [],
        "critical-failure": [{ kind: "lock-action", actionId: "escape-grab" }],
      },
    },
  },
  {
    id: "interact-lever",
    name: "Interact",
    description: "인접한 레버를 작동해 차단된 문을 엽니다.",
    timing: { kind: "turn", actions: 1 },
    traits: [trait("manipulate")],
    targeting: "object",
    effect: { kind: "interact" },
  },
  {
    id: "raise-shield",
    name: "Raise Shield",
    description: "다음 자기 턴 시작까지 Shield의 AC 보너스를 얻습니다.",
    timing: { kind: "turn", actions: 1 },
    traits: [trait("concentrate")],
    targeting: "self",
    effect: { kind: "raise-shield" },
  },
  {
    id: "sustain-spell",
    name: "Sustain Spell",
    description: "선택한 지속 주문 효과를 다음 턴까지 연장합니다.",
    timing: { kind: "turn", actions: 1 },
    traits: [trait("concentrate")],
    targeting: "effect",
    effect: { kind: "sustain-effect" },
  },
  {
    id: "trip",
    name: "Trip",
    description: "Halberd의 Athletics 판정으로 대상을 Prone으로 만듭니다.",
    timing: { kind: "turn", actions: 1 },
    traits: [trait("attack"), trait("skill"), trait("trip")],
    targeting: "enemy",
    effect: { kind: "trip" },
  },
  {
    id: "fly",
    name: "Fly",
    description: "Difficult와 Impassable을 무시하고 Speed만큼 이동합니다.",
    timing: { kind: "turn", actions: 1 },
    traits: [trait("move"), trait("fly")],
    targeting: "tile",
    effect: { kind: "move", movementMode: "fly", step: false, triggersReactions: true },
  },
  {
    id: "spirit-beacon",
    name: "Spirit Beacon",
    description: "Sustain할 수 있는 빛의 표식을 자신에게 부착합니다.",
    timing: { kind: "turn", actions: 1 },
    traits: [trait("concentrate"), trait("focus")],
    targeting: "self",
    effect: { kind: "create-sustained-effect", effectName: "Spirit Beacon" },
  },
  {
    id: "reactive-strike",
    name: "Reactive Strike",
    description: "전방 또는 측면 Reach에서 적이 Move를 시작하면 Strike합니다.",
    timing: { kind: "reaction" },
    traits: [trait("attack"), trait("reaction")],
    targeting: "enemy",
    effect: { kind: "weapon-attack", damageMultiplier: 1 },
  },
  {
    id: "knockdown",
    name: "Knockdown",
    description: "강한 공격으로 피해를 주고 성공 시 대상을 Prone으로 만듭니다.",
    timing: { kind: "turn", actions: 2 },
    traits: [trait("attack")],
    targeting: "enemy",
    effect: { kind: "weapon-attack", damageMultiplier: 1, applyCondition: "prone" },
  },
];

const cards: readonly CardDefinition[] = [
  { id: "card.trip", name: "Trip", actionId: "trip", traits: [trait("attack"), trait("trip")] },
  { id: "card.fly", name: "Fly", actionId: "fly", traits: [trait("move"), trait("fly")] },
  {
    id: "card.spirit-beacon",
    name: "Spirit Beacon",
    actionId: "spirit-beacon",
    traits: [trait("focus"), trait("concentrate")],
  },
  {
    id: "card.reactive-strike",
    name: "Reactive Strike",
    actionId: "reactive-strike",
    traits: [trait("attack"), trait("reaction")],
  },
];

const traits: readonly TraitDefinition[] = [
  {
    id: "trip",
    name: "Trip",
    cardGrants: [{ cardDefinitionId: "card.trip", count: 3 }],
    actionGrants: [],
  },
  {
    id: "fly",
    name: "Fly",
    cardGrants: [{ cardDefinitionId: "card.fly", count: 2 }],
    actionGrants: [],
  },
  {
    id: "shield",
    name: "Shield",
    cardGrants: [],
    actionGrants: [{ actionId: "raise-shield", contextGroup: "shield" }],
  },
  {
    id: "prone",
    name: "Prone Recovery",
    cardGrants: [],
    actionGrants: [{ actionId: "stand", contextGroup: "escape" }],
  },
  {
    id: "grabbed",
    name: "Grabbed Recovery",
    cardGrants: [],
    actionGrants: [{ actionId: "escape-grab", contextGroup: "escape" }],
  },
];

const conditions: readonly ConditionDefinition[] = [
  { id: "prone", name: "Prone", traits: [trait("condition"), trait("prone")] },
  { id: "grabbed", name: "Grabbed", traits: [trait("condition"), trait("grabbed")] },
];

const equipment: readonly EquipmentDefinition[] = [
  {
    id: "halberd",
    name: "Halberd",
    traits: [trait("weapon"), trait("trip"), trait("reach")],
    statModifiers: [],
    weaponProfile: {
      name: "Halberd",
      attackModifier: 8,
      rangeFeet: 10,
      damage: { count: 1, sides: 12, modifier: 4, damageType: "slashing" },
    },
  },
  {
    id: "shield",
    name: "Steel Shield",
    traits: [trait("shield")],
    statModifiers: [],
    shieldBonus: 2,
  },
  {
    id: "boots-of-fly",
    name: "Boots of Fly",
    traits: [trait("fly")],
    statModifiers: [{ selector: "reflex", value: 1, label: "Boots of Fly" }],
  },
];

export const M0_CONTENT: CombatContent = {
  actions: Object.fromEntries(actions.map((action) => [action.id, action])),
  cards: Object.fromEntries(cards.map((card) => [card.id, card])),
  equipment: Object.fromEntries(equipment.map((item) => [item.id, item])),
  traits: Object.fromEntries(traits.map((item) => [item.id, item])),
  conditions: Object.fromEntries(conditions.map((item) => [item.id, item])),
};

function createMap(): BattleMapState {
  const width = 9;
  const height = 7;
  const tiles: Record<string, TileState> = {};
  const positionsWithTrait: Readonly<Record<string, readonly TraitInstance[]>> = {
    "2,2": [trait("open"), trait("difficult")],
    "2,3": [trait("open"), trait("difficult")],
    "3,4": [trait("impassable")],
    "3,5": [trait("impassable")],
    "5,3": [trait("open"), trait("difficult"), trait("web")],
  };

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const position = { x, y };
      const key = positionKey(position);
      const isWall = x === 4 && y !== 3;
      const isGate = x === 4 && y === 3;
      tiles[key] = {
        id: `tile-${key}`,
        position,
        traits: isWall || isGate ? [trait("blocked"), trait(isGate ? "gate" : "stone")] : (positionsWithTrait[key] ?? [trait("open")]),
      };
    }
  }

  return {
    width,
    height,
    tiles,
    objects: {
      "gate-lever": {
        id: "gate-lever",
        name: "Ancient Gate Lever",
        position: { x: 1, y: 2 },
        traits: [trait("interactable"), trait("lever")],
        interaction: { kind: "open-gate", targetTileId: "tile-4,3" },
        used: false,
      },
    },
  };
}

const fallbackWeapon = (
  name: string,
  attackModifier: number,
  sides: number,
  modifier: number,
  damageType: "slashing" | "piercing" | "bludgeoning",
) => ({
  name,
  attackModifier,
  rangeFeet: 5,
  damage: { count: 1, sides, modifier, damageType },
});

const actor = (setup: ActorSetup): ActorSetup => setup;

const actors: readonly ActorSetup[] = [
  actor({
    id: "hero",
    name: "Aerin",
    team: "heroes",
    position: { x: 1, y: 3 },
    facing: "east",
    hp: 32,
    maxHp: 32,
    baseAc: 18,
    reflexModifier: 5,
    athleticsModifier: 8,
    initiativeModifier: 6,
    speedFeet: 25,
    fallbackWeapon: fallbackWeapon("Unarmed", 6, 4, 2, "bludgeoning"),
    conditions: [],
    traits: [trait("actor"), trait("hero")],
    equipmentIds: ["halberd", "shield", "boots-of-fly"],
    innateActionIds: [],
    baseCardGrants: [
      { cardDefinitionId: "card.spirit-beacon", count: 2, sourceId: "focus.spirit-beacon" },
      { cardDefinitionId: "card.reactive-strike", count: 1, sourceId: "feat.reactive-strike" },
    ],
  }),
  actor({
    id: "goblin-skirmisher",
    name: "Goblin Skirmisher",
    team: "enemies",
    position: { x: 7, y: 2 },
    facing: "west",
    hp: 18,
    maxHp: 18,
    baseAc: 16,
    reflexModifier: 5,
    athleticsModifier: 4,
    initiativeModifier: 5,
    speedFeet: 25,
    fallbackWeapon: fallbackWeapon("Goblin Blade", 6, 6, 2, "slashing"),
    conditions: [],
    traits: [trait("actor"), trait("goblin")],
    equipmentIds: [],
    innateActionIds: [],
    baseCardGrants: [],
  }),
  actor({
    id: "goblin-brute",
    name: "Goblin Brute",
    team: "enemies",
    position: { x: 7, y: 4 },
    facing: "west",
    hp: 24,
    maxHp: 24,
    baseAc: 17,
    reflexModifier: 3,
    athleticsModifier: 7,
    initiativeModifier: 3,
    speedFeet: 20,
    fallbackWeapon: fallbackWeapon("Heavy Club", 7, 8, 3, "bludgeoning"),
    conditions: [],
    traits: [trait("actor"), trait("goblin")],
    equipmentIds: [],
    innateActionIds: ["knockdown"],
    baseCardGrants: [],
  }),
];

export const M0_SCENARIO: ScenarioDefinition = {
  id: "m0-gatehouse",
  name: "The Webbed Gatehouse",
  objective: "레버로 문을 열고 두 고블린을 쓰러뜨리세요.",
  actors,
  map: createMap(),
};

export function cloneM0Scenario(): ScenarioDefinition {
  return {
    ...M0_SCENARIO,
    actors: M0_SCENARIO.actors.map((entry) => ({
      ...entry,
      position: { ...entry.position },
      conditions: entry.conditions.map((condition) => ({ ...condition })),
      traits: entry.traits.map((entryTrait) => ({ ...entryTrait })),
      equipmentIds: [...entry.equipmentIds],
      innateActionIds: [...entry.innateActionIds],
      baseCardGrants: entry.baseCardGrants.map((grant) => ({ ...grant })),
    })),
    map: {
      ...M0_SCENARIO.map,
      tiles: Object.fromEntries(
        Object.values(M0_SCENARIO.map.tiles).map((tile) => [
          positionKey(tile.position),
          { ...tile, position: { ...tile.position }, traits: tile.traits.map((entryTrait) => ({ ...entryTrait })) },
        ]),
      ),
      objects: Object.fromEntries(
        Object.values(M0_SCENARIO.map.objects).map((object) => [
          object.id,
          {
            ...object,
            position: { ...object.position },
            traits: object.traits.map((entryTrait) => ({ ...entryTrait })),
            interaction: { ...object.interaction },
          },
        ]),
      ),
    },
  };
}

export function terrainLabel(position: GridPosition): string {
  const tile = M0_SCENARIO.map.tiles[positionKey(position)];
  if (!tile) return "Void";
  if (tile.traits.some((entry) => entry.id === "blocked")) return "Wall";
  if (tile.traits.some((entry) => entry.id === "impassable")) return "Chasm";
  if (tile.traits.some((entry) => entry.id === "web")) return "Web";
  if (tile.traits.some((entry) => entry.id === "difficult")) return "Rubble";
  return "Open";
}
