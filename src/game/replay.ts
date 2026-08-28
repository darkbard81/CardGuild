import { createCombat, dispatchCombatCommand } from "./engine";
import type { CombatCommand, CombatContent, CombatEvent, CombatState, ScenarioDefinition } from "./types";

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const record = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`)
    .join(",")}}`;
}

export function hashCombatState(state: CombatState): string {
  const serialized = canonicalize(state);
  let hash = 0xcbf2_9ce4_8422_2325n;
  const prime = 0x0000_0100_0000_01b3n;
  const mask = 0xffff_ffff_ffff_ffffn;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= BigInt(serialized.charCodeAt(index));
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, "0");
}

export function replayCombat(
  scenario: ScenarioDefinition,
  content: CombatContent,
  seed: number,
  commands: readonly CombatCommand[],
): { readonly state: CombatState; readonly events: readonly CombatEvent[] } {
  const setup = createCombat(scenario, content, seed);
  let state = setup.state;
  const events = [...setup.events];
  for (const command of commands) {
    const result = dispatchCombatCommand(state, command, content);
    if (!result.accepted) throw new Error(`Replay rejected ${command.id}: ${result.error}`);
    state = result.state;
    events.push(...result.events);
  }
  return { state, events };
}
