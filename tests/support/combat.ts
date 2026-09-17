import {
  createCombat, dispatchCombatCommand,
  type ActionDefinition, type ActorSetup, type CombatCommand, type CombatDefinition,
  type CombatState, type DegreeOutcomeMap, type TraitInstance,
} from "../../src/game";

const outcomes: DegreeOutcomeMap = {
  "critical-success": [], success: [], failure: [], "critical-failure": [],
};

/** A five-square lane makes distance, terrain and occupancy observable without a path golden. */
export function laneCombat(options: {
  ally?: boolean;
  terrain?: Readonly<Record<number, readonly TraitInstance[]>>;
  reaction?: boolean;
} = {}): CombatDefinition {
  const move = (id: string, step: boolean, fly = false): ActionDefinition => ({
    id, name: id, description: "Move along the lane", traits: [{ id: "move" }],
    timing: { kind: "turn", actions: 1 }, targeting: "tile",
    resolution: { kind: "move", movementMode: fly ? "fly" : "land", step, triggersReactions: !step },
  });
  const strike: ActionDefinition = {
    id: "strike", name: "Strike", description: "Weapon attack", traits: [{ id: "attack" }],
    timing: { kind: "turn", actions: 1 }, targeting: "enemy", range: { kind: "weapon-reach" },
    resolution: { kind: "strike", damageMultiplier: 1, outcomes },
  };
  const actor = (id: string, x: number, hero: boolean, perception: number): ActorSetup => ({
    id, definitionId: id, name: id, team: hero ? "heroes" : "enemies",
    position: { x, y: 0 }, facing: hero ? "east" : "west", hp: 30, maxHp: 30,
    speedFeet: 15, conditions: [], traits: [{ id: "actor" }, { id: "fly" }],
    equipmentIds: [], innateActionIds: [],
    deckContributions: [{ cardDefinitionId: "card.hit", count: 1, source: { kind: "base", sourceId: id } },
      ...(options.reaction && hero ? [{ cardDefinitionId: "card.reactive-strike", count: 1, source: { kind: "base" as const, sourceId: id } }] : [])],
    statProfile: { kind: "creature", stats: {
      ac: 16, maxHp: 30, perception, saves: { fortitude: 4, reflex: 3, will: 2 }, skills: { athletics: 5 },
      strike: { name: "Spear", attackModifier: 8, rangeFeet: 5,
        damage: { count: 1, sides: 6, modifier: 3, damageType: "piercing" }, traits: [] },
    } },
  });
  return {
    contentIdentity: { packId: "contract-lane", packVersion: "1", fingerprint: "contract-lane-v1" },
    content: {
      classes: {}, traits: {}, conditions: {}, equipment: {},
      cards: {
        "card.hit": { id: "card.hit", name: "Hit", actionId: "strike", level: 1, traits: [{ id: "attack" }] },
        "card.reactive-strike": { id: "card.reactive-strike", name: "Reactive Strike", actionId: "reactive-strike", level: 1, traits: [{ id: "attack" }] },
      },
      actions: { stride: move("stride", false), step: move("step", true), fly: move("fly", false, true), strike,
        "reactive-strike": { ...strike, id: "reactive-strike", timing: { kind: "reaction" } } },
    },
    scenario: {
      id: "lane", name: "Lane", objective: { kind: "defeat-all-enemies", description: "Defeat the enemy" },
      actors: [actor("hero", 0, true, 100), actor("enemy", 3, false, -100),
        ...(options.ally ? [actor("ally", 1, true, -200)] : [])],
      map: { width: 5, height: 1, objects: {}, tiles: Object.fromEntries(
        Array.from({ length: 5 }, (_, x) => [`${x},0`, { id: `tile-${x}`, position: { x, y: 0 }, traits: options.terrain?.[x] ?? [] }]),
      ) },
    },
  };
}

export type CombatInput = CombatCommand extends infer C
  ? C extends CombatCommand ? Omit<C, "id" | "sequence"> : never : never;

export function command(state: CombatState, input: CombatInput): CombatCommand {
  return { ...input, id: `command-${state.sequence + 1}`, sequence: state.sequence + 1 };
}

export function play(state: CombatState, input: CombatInput, definition: CombatDefinition): CombatState {
  const result = dispatchCombatCommand(state, command(state, input), definition.content);
  if (!result.accepted) throw new Error(`Fixture command rejected: ${result.error}`);
  return result.state;
}

export function battle(definition = laneCombat()): CombatState {
  return createCombat(definition, 60).state;
}
