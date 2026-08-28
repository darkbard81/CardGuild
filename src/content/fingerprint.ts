import type { ContentPackSource } from "./content-types";

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
    scenario: {
      ...source.scenario,
      actorIds: [...source.scenario.actorIds],
      map: {
        ...source.scenario.map,
        tiles: [...source.scenario.map.tiles].sort(
          (left, right) =>
            left.position.y - right.position.y ||
            left.position.x - right.position.x ||
            left.id.localeCompare(right.id),
        ),
        objects: byId(source.scenario.map.objects),
      },
    },
  };
}

export function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  const record = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`)
    .join(",")}}`;
}

export function fingerprintContentPack(source: ContentPackSource): string {
  const serialized = stableSerialize(normalizeContentPack(source));
  let hash = 0xcbf2_9ce4_8422_2325n;
  const prime = 0x0000_0100_0000_01b3n;
  const mask = 0xffff_ffff_ffff_ffffn;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= BigInt(serialized.charCodeAt(index));
    hash = (hash * prime) & mask;
  }
  return `fnv1a64:${hash.toString(16).padStart(16, "0")}`;
}
