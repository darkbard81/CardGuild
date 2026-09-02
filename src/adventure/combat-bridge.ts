import { getContentIdentity } from "../content/compile-content";
import type { CompiledContentPack } from "../content/content-types";
import { positionKey } from "../game/grid";
import type { CombatDefinition } from "../game/types";
import { deriveActorSetup, validatePartyLoadout } from "../loadout";
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
  const validation = validatePartyLoadout(state.party, state.collection, pack);
  if (!validation.valid) throw new Error(`Adventure party loadout is invalid: ${validation.issues[0]?.message ?? "unknown error"}`);

  const staticActors = source.placements.map((placement) => {
    const actorDefinition = pack.actorDefinitions[placement.actorDefinitionId];
    if (!actorDefinition) throw new Error(`Actor definition "${placement.actorDefinitionId}" is missing.`);
    return deriveActorSetup(actorDefinition, placement, actorDefinition.starterLoadout, pack.combatContent);
  });
  const spawnSlots = new Map(source.partySpawnSlots.map((slot) => [slot.seat, slot]));
  const partyActors = Object.values(state.party.members)
    .sort((left, right) => left.seat - right.seat || left.id.localeCompare(right.id))
    .map((partyMember) => {
      const actorDefinition = pack.actorDefinitions[partyMember.actorDefinitionId];
      if (!actorDefinition) throw new Error(`Actor definition "${partyMember.actorDefinitionId}" is missing.`);
      const spawn = spawnSlots.get(partyMember.seat);
      if (!spawn) throw new Error(`Scenario "${source.id}" has no spawn slot for seat ${partyMember.seat}.`);
      return deriveActorSetup(actorDefinition, {
        instanceId: partyMember.id,
        actorDefinitionId: partyMember.actorDefinitionId,
        team: "heroes",
        position: { ...spawn.position },
        facing: spawn.facing,
      }, partyMember.loadout, pack.combatContent, partyMember.id);
    });
  const actors = [...partyActors, ...staticActors];

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
