import { buildActorSetup, getContentIdentity } from "../content/compile-content";
import type { CompiledContentPack } from "../content/content-types";
import { positionKey } from "../game/grid";
import type { CombatDefinition } from "../game/types";
import { deriveCombatSeed } from "./runtime";
import type { AdventureState } from "./types";

export interface AdventureEncounterDefinition {
  readonly definition: CombatDefinition;
  readonly seed: number;
}

export function buildAdventureEncounter(
  pack: CompiledContentPack,
  state: AdventureState,
): AdventureEncounterDefinition {
  const scenarioId = state.currentEncounterId;
  if (state.phase !== "combat" || !scenarioId) throw new Error("Adventure is not in an active combat phase.");
  const source = pack.scenarioSources[scenarioId];
  if (!source) throw new Error(`Scenario "${scenarioId}" is not present in the compiled content pack.`);

  const actors = source.placements.map((placement) => {
    const actorDefinition = pack.actorDefinitions[placement.actorDefinitionId];
    if (!actorDefinition) throw new Error(`Actor definition "${placement.actorDefinitionId}" is missing.`);
    if (!placement.partyMemberId) return buildActorSetup(actorDefinition, placement);
    const partyMember = state.party.members[placement.partyMemberId];
    if (!partyMember) throw new Error(`Party member "${placement.partyMemberId}" is missing.`);
    if (partyMember.actorDefinitionId !== placement.actorDefinitionId) {
      throw new Error(`Party member "${partyMember.id}" does not match actor definition "${placement.actorDefinitionId}".`);
    }
    return buildActorSetup(actorDefinition, placement, partyMember.equipmentIds);
  });

  return {
    seed: deriveCombatSeed(state.adventureSeed, scenarioId),
    definition: {
      content: pack.combatContent,
      contentIdentity: getContentIdentity(pack),
      scenario: {
        id: source.id,
        name: source.name,
        objective: { ...source.objective },
        actors,
        map: {
          width: source.map.width,
          height: source.map.height,
          tiles: Object.fromEntries(source.map.tiles.map((tile) => [positionKey(tile.position), tile])),
          objects: Object.fromEntries(source.map.objects.map((object) => [object.id, object])),
        },
      },
    },
  };
}
