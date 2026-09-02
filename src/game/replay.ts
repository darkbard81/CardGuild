import { createCombat, dispatchCombatCommand } from "./engine";
import { computeCombatSetupFingerprint, fnv1a64, stableSerialize } from "./determinism";
import type { CombatDefinition, CombatEvent, CombatReplay, CombatState, ContentIdentity } from "./types";

export function hashCombatState(state: CombatState): string {
  return fnv1a64(stableSerialize(state));
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
    setupFingerprint: state.setupFingerprint,
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

  const setupFingerprint = computeCombatSetupFingerprint(definition, replay.seed);
  if (replay.setupFingerprint !== setupFingerprint) {
    throw new Error(`Replay setup mismatch: expected ${replay.setupFingerprint}, loaded ${setupFingerprint}.`);
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
