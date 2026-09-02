import type { ContentPackSource } from "./content-types";
import { fingerprintValue, stableSerialize } from "../game/determinism";

function byId<T extends { readonly id: string }>(values: readonly T[]): readonly T[] {
  return [...values].sort((left, right) => left.id.localeCompare(right.id));
}

export function normalizeContentPack(source: ContentPackSource): ContentPackSource {
  return {
    manifest: source.manifest,
    traits: byId(source.traits),
    conditions: byId(source.conditions),
    actions: byId(source.actions),
    cards: byId(source.cards),
    equipment: byId(source.equipment),
    actors: byId(source.actors),
    scenarios: byId(source.scenarios).map((scenario) => ({
      ...scenario,
      placements: [...scenario.placements].sort((left, right) => left.instanceId.localeCompare(right.instanceId)),
      partySpawnSlots: [...scenario.partySpawnSlots].sort((left, right) => left.seat - right.seat),
      map: {
        ...scenario.map,
        tiles: [...scenario.map.tiles].sort(
          (left, right) =>
            left.position.y - right.position.y ||
            left.position.x - right.position.x ||
            left.id.localeCompare(right.id),
        ),
        objects: byId(scenario.map.objects),
      },
    })),
    adventures: byId(source.adventures).map((adventure) => ({
      ...adventure,
      encounterIds: [...adventure.encounterIds],
      rewards: byId(adventure.rewards).map((reward) => ({ ...reward, choices: [...reward.choices] })),
    })),
  };
}

export function fingerprintContentPack(source: ContentPackSource): string {
  return fingerprintValue(normalizeContentPack(source));
}

export { stableSerialize };
