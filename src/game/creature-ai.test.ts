import { describe, expect, it } from "vitest";

import { buildActorSetup } from "../content/compile-content";
import { M7_COMBAT_DEFINITION, M7_COMPILED_PACK, M7_CONTENT } from "../content/load-m7-content";
import { chooseAiCommand } from "./ai";
import { createCombat, dispatchCombatCommand } from "./engine";
import { listLegalActions } from "./queries";
import type { ActorSetup, CombatCommand, CombatState, Direction, GridPosition } from "./types";

const CONTENT = M7_CONTENT;

interface Placement {
  readonly id: string;
  readonly definitionId: string;
  readonly team: "heroes" | "enemies";
  readonly position: GridPosition;
  readonly facing?: Direction;
  readonly initiative?: number;
  readonly hp?: number;
}

function setup(placement: Placement): ActorSetup {
  const definition = M7_COMPILED_PACK.actorDefinitions[placement.definitionId];
  if (!definition) throw new Error(`Actor definition "${placement.definitionId}" is missing.`);
  const actor = buildActorSetup(
    definition,
    {
      instanceId: placement.id,
      actorDefinitionId: placement.definitionId,
      team: placement.team,
      position: placement.position,
      facing: placement.facing ?? "south",
    },
    CONTENT,
  );
  // Initiative is a statistic, so it is steered through the profile rather than by
  // reordering the turn list behind the engine's back.
  const initiative = placement.initiative ?? 0;
  const statProfile: ActorSetup["statProfile"] = actor.statProfile.kind === "character"
    ? {
        kind: "character",
        stats: {
          ...actor.statProfile.stats,
          attributes: { ...actor.statProfile.stats.attributes, wis: initiative },
        },
      }
    : { kind: "creature", stats: { ...actor.statProfile.stats, perception: initiative } };
  return { ...actor, statProfile, hp: placement.hp ?? actor.hp };
}

/** A combat containing exactly the placements a test cares about, on the shipped map. */
function arena(placements: readonly Placement[], seed = 7): CombatState {
  const scenario = { ...M7_COMBAT_DEFINITION.scenario, actors: placements.map(setup) };
  return createCombat({ ...M7_COMBAT_DEFINITION, scenario }, seed).state;
}

function aiCommand(state: CombatState): CombatCommand {
  const command = chooseAiCommand(state, CONTENT);
  if (!command) throw new Error("The AI produced no command.");
  return command;
}

function actionIdOf(command: CombatCommand): string {
  if (command.type !== "use-action") return command.type;
  if (command.action.kind === "card") return "card";
  return command.action.id;
}

// The shipped map is a 9x7 chamber split by a wall column at x = 4, so every position
// below is on the hero's side and has real line of sight to (1, 1).
const HERO: Placement = { id: "hero", definitionId: "hero.aerin", team: "heroes", position: { x: 1, y: 1 }, facing: "east", initiative: -100 };
const FAR = { x: 3, y: 6 } as const;      // 35 ft from the hero, still in sight
const MID = { x: 3, y: 3 } as const;      // 20 ft: past weapon reach, inside a 30 ft action
const ADJACENT = { x: 2, y: 1 } as const; // 5 ft

describe("creature AI action consumption", () => {
  it("uses a Fixed Strike's own range instead of closing on the hero", () => {
    // The archer's authored Strike reaches 60 ft, so the generic Strike step is legal from
    // across the board and the AI never falls through to Stride.
    const state = arena([
      HERO,
      { id: "archer", definitionId: "enemy.skeleton-archer", team: "enemies", position: FAR, facing: "north", initiative: 100 },
    ]);
    expect(state.turn.activeActorId).toBe("archer");
    const command = aiCommand(state);
    expect(actionIdOf(command)).toBe("strike");
    expect(command.type === "use-action" && command.target).toEqual({ kind: "actor", actorId: "hero" });

    // A melee creature at the same distance has to move instead.
    const melee = arena([
      HERO,
      { id: "rabble", definitionId: "enemy.skeleton-rabble", team: "enemies", position: FAR, facing: "north", initiative: 100 },
    ]);
    expect(actionIdOf(aiCommand(melee))).toBe("stride");
  });

  it("takes innate actions in the order the creature declares them", () => {
    // Dire Wolf declares ["terrifying-howl", "trip"]; both are legal in reach.
    const adjacent = arena([
      HERO,
      { id: "wolf", definitionId: "enemy.dire-wolf", team: "enemies", position: ADJACENT, facing: "west", initiative: 100 },
    ]);
    const legal = listLegalActions(adjacent, "wolf", CONTENT).filter((action) => action.enabled);
    expect(legal.map((action) => action.actionId)).toEqual(expect.arrayContaining(["terrifying-howl", "trip"]));
    expect(actionIdOf(aiCommand(adjacent))).toBe("terrifying-howl");

    // Out of Trip's weapon reach but inside the howl's 30 ft, only the first still applies.
    const distant = arena([
      HERO,
      { id: "wolf", definitionId: "enemy.dire-wolf", team: "enemies", position: MID, facing: "north", initiative: 100 },
    ]);
    expect(actionIdOf(aiCommand(distant))).toBe("terrifying-howl");
  });

  it("falls through to a later innate action when the first is not legal", () => {
    // The Chief declares ["knockdown", "demoralize"]. Knockdown is a Strike at weapon
    // reach; from 30 ft away only the second option survives.
    const distant = arena([
      HERO,
      { id: "chief", definitionId: "enemy.goblin-chief", team: "enemies", position: MID, facing: "north", initiative: 100 },
    ]);
    expect(actionIdOf(aiCommand(distant))).toBe("demoralize");

    const adjacent = arena([
      HERO,
      { id: "chief", definitionId: "enemy.goblin-chief", team: "enemies", position: ADJACENT, facing: "west", initiative: 100 },
    ]);
    expect(actionIdOf(aiCommand(adjacent))).toBe("knockdown");
  });

  it("heals a wounded teammate and no one else", () => {
    const wounded = arena([
      HERO,
      { id: "priest", definitionId: "enemy.bone-priest", team: "enemies", position: { x: 2, y: 4 }, facing: "north", initiative: 100 },
      { id: "hulk", definitionId: "enemy.bone-hulk", team: "enemies", position: { x: 2, y: 5 }, facing: "north", initiative: -1, hp: 5 },
    ]);
    const command = aiCommand(wounded);
    expect(actionIdOf(command)).toBe("mend-bone");
    expect(command.type === "use-action" && command.target).toEqual({ kind: "actor", actorId: "hulk" });

    // At full HP the same teammate is not a candidate, so the priest moves on.
    const healthy = arena([
      HERO,
      { id: "priest", definitionId: "enemy.bone-priest", team: "enemies", position: { x: 2, y: 4 }, facing: "north", initiative: 100 },
      { id: "hulk", definitionId: "enemy.bone-hulk", team: "enemies", position: { x: 2, y: 5 }, facing: "north", initiative: -1 },
    ]);
    expect(actionIdOf(aiCommand(healthy))).not.toBe("mend-bone");
  });

  it("picks the most hurt teammate deterministically and never a wounded enemy", () => {
    const state = arena([
      { ...HERO, hp: 1 },
      { id: "priest", definitionId: "enemy.bone-priest", team: "enemies", position: { x: 2, y: 4 }, facing: "north", initiative: 100 },
      { id: "hulk", definitionId: "enemy.bone-hulk", team: "enemies", position: { x: 2, y: 5 }, facing: "north", initiative: -1, hp: 24 },
      { id: "rabble", definitionId: "enemy.skeleton-rabble", team: "enemies", position: { x: 2, y: 6 }, facing: "north", initiative: -2, hp: 3 },
    ]);
    const command = aiCommand(state);
    expect(actionIdOf(command)).toBe("mend-bone");
    // Rabble is at 3/12, the hulk at 24/32; the wounded hero is never considered.
    expect(command.type === "use-action" && command.target).toEqual({ kind: "actor", actorId: "rabble" });
  });

  it("falls back through Strike, Stride and End Turn", () => {
    const adjacent = arena([
      HERO,
      { id: "rabble", definitionId: "enemy.skeleton-rabble", team: "enemies", position: ADJACENT, facing: "west", initiative: 100 },
    ]);
    expect(actionIdOf(aiCommand(adjacent))).toBe("strike");

    const far = arena([
      HERO,
      { id: "rabble", definitionId: "enemy.skeleton-rabble", team: "enemies", position: FAR, facing: "north", initiative: 100 },
    ]);
    expect(actionIdOf(aiCommand(far))).toBe("stride");

    // Nothing left to reach or shorten: the turn simply ends.
    const alone = arena([
      HERO,
      { id: "rabble", definitionId: "enemy.skeleton-rabble", team: "enemies", position: ADJACENT, facing: "west", initiative: 100 },
    ]);
    let current = alone;
    for (let guard = 0; guard < 6; guard += 1) {
      const command = chooseAiCommand(current, CONTENT);
      if (!command) break;
      const result = dispatchCombatCommand(current, command, CONTENT);
      expect(result.accepted).toBe(true);
      current = result.state;
      if (current.turn.activeActorId !== "rabble") break;
    }
    expect(current.turn.activeActorId).not.toBe("rabble");
  });

  it("spends an innate action once a turn and then falls through to its Strike", () => {
    // #21 found the Goblin Spearman spending every action of every turn on Trip, at -5 and
    // then -10, so its authored Strike never appeared and the encounter dealt no damage.
    const state = arena([
      HERO,
      { id: "spearman", definitionId: "enemy.goblin-spearman", team: "enemies", position: ADJACENT, facing: "west", initiative: 100 },
    ]);
    const taken: string[] = [];
    let current = state;
    for (let guard = 0; guard < 6; guard += 1) {
      const command = chooseAiCommand(current, CONTENT);
      if (!command) break;
      taken.push(actionIdOf(command));
      const result = dispatchCombatCommand(current, command, CONTENT);
      expect(result.accepted).toBe(true);
      current = result.state;
      if (current.turn.activeActorId !== "spearman") break;
    }
    expect(taken).toEqual(["trip", "strike", "strike", "end-turn"]);
    expect(taken.filter((actionId) => actionId === "trip")).toHaveLength(1);
  });

  it("stays deterministic for the same state", () => {
    const build = (): CombatState => arena([
      HERO,
      { id: "wolf", definitionId: "enemy.dire-wolf", team: "enemies", position: MID, facing: "north", initiative: 100 },
    ]);
    expect(aiCommand(build())).toEqual(aiCommand(build()));
  });
});

describe("creature roster", () => {
  const enemies = Object.values(M7_COMPILED_PACK.actorDefinitions)
    .filter((definition) => definition.statProfile.kind === "creature");

  it("ships 15 to 20 enemies across several roles", () => {
    expect(enemies.length).toBeGreaterThanOrEqual(15);
    expect(enemies.length).toBeLessThanOrEqual(20);
    const ranged = enemies.filter((definition) =>
      definition.statProfile.kind === "creature" && definition.statProfile.stats.strike.rangeFeet > 10);
    const withInnate = enemies.filter((definition) => definition.innateActionIds.length > 0);
    expect(ranged.length).toBeGreaterThanOrEqual(2);
    expect(withInnate.length).toBeGreaterThanOrEqual(6);
  });

  it("references only innate actions that exist and that the AI can aim", () => {
    for (const definition of enemies) {
      for (const actionId of definition.innateActionIds) {
        const action = CONTENT.actions[actionId];
        expect(`${definition.id}:${actionId}:${String(Boolean(action))}`).toBe(`${definition.id}:${actionId}:true`);
        // Tile, object and effect targeting have no AI policy, so authoring one as innate
        // would create content the AI silently ignores.
        expect(`${definition.id}:${actionId}:${action?.targeting ?? ""}`).toBe(
          `${definition.id}:${actionId}:${["self", "none", "enemy", "ally", "creature"].includes(action?.targeting ?? "") ? action?.targeting ?? "" : "unsupported"}`,
        );
      }
    }
  });

  it("gives every enemy at least one action it can actually take", () => {
    for (const definition of enemies) {
      const state = arena([
        HERO,
        { id: "enemy", definitionId: definition.id, team: "enemies", position: ADJACENT, facing: "west", initiative: 100 },
      ]);
      const command = chooseAiCommand(state, CONTENT);
      expect(`${definition.id}:${String(command?.type)}`).toBe(`${definition.id}:use-action`);
      const result = dispatchCombatCommand(state, command as CombatCommand, CONTENT);
      expect(`${definition.id}:${String(result.accepted)}`).toBe(`${definition.id}:true`);
    }
  });
});
