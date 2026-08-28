import { createCombat, dispatchCombatCommand } from "./engine";
import type { CombatDefinition, CombatEvent, CombatReplay, CombatState, ContentIdentity } from "./types";

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

function sameContentIdentity(left: ContentIdentity, right: ContentIdentity): boolean {
  return left.packId === right.packId &&
    left.packVersion === right.packVersion &&
    left.fingerprint === right.fingerprint;
}

export function createCombatReplay(state: CombatState): CombatReplay {
  return {
    scenarioId: state.scenarioId,
    seed: state.seed,
    contentIdentity: { ...state.contentIdentity },
    commands: [...state.commandLog],
  };
}

export function replayCombat(
  definition: CombatDefinition,
  replay: CombatReplay,
): { readonly state: CombatState; readonly events: readonly CombatEvent[] } {
  if (replay.scenarioId !== definition.scenario.id) {
    throw new Error(`Replay scenario mismatch: expected ${replay.scenarioId}, loaded ${definition.scenario.id}.`);
  }
  if (!sameContentIdentity(replay.contentIdentity, definition.contentIdentity)) {
    throw new Error(
      `Replay content mismatch: expected ${replay.contentIdentity.packId}@${replay.contentIdentity.packVersion} ` +
      `(${replay.contentIdentity.fingerprint}), loaded ${definition.contentIdentity.packId}@${definition.contentIdentity.packVersion} ` +
      `(${definition.contentIdentity.fingerprint}).`,
    );
  }

  const setup = createCombat(definition, replay.seed);
  let state = setup.state;
  const events = [...setup.events];
  for (const command of replay.commands) {
    const result = dispatchCombatCommand(state, command, definition.content);
    if (!result.accepted) throw new Error(`Replay rejected ${command.id}: ${result.error}`);
    state = result.state;
    events.push(...result.events);
  }
  return { state, events };
}
