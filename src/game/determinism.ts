import type { CombatDefinition } from "./types";

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

export function fnv1a64(serialized: string): string {
  let hash = 0xcbf2_9ce4_8422_2325n;
  const prime = 0x0000_0100_0000_01b3n;
  const mask = 0xffff_ffff_ffff_ffffn;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= BigInt(serialized.charCodeAt(index));
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, "0");
}

export function fingerprintValue(value: unknown): string {
  return `fnv1a64:${fnv1a64(stableSerialize(value))}`;
}

export function computeCombatSetupFingerprint(definition: CombatDefinition, seed: number): string {
  return fingerprintValue({
    scenario: definition.scenario,
    seed,
    contentIdentity: definition.contentIdentity,
  });
}
