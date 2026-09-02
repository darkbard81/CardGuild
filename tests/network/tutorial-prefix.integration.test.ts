import { describe, expect, it } from "vitest";

import { PRODUCTION_CONTENT } from "../../src/content";
import { chooseAiCommand, gridDistance, listLegalActions, listLegalTargets } from "../../src/game";
import type { ActionSource, ActionTarget, CombatCommand, CombatState, LegalTarget } from "../../src/game";
import {
  createSessionCoreState,
  dispatchServerCombatCommand,
  dispatchSessionIntent,
} from "../../src/session";
import type {
  SessionAuthorityContext,
  SessionControlContext,
  SessionCoreState,
  SessionIntent,
} from "../../src/session";

const CONTEXT: SessionAuthorityContext = {
  pack: PRODUCTION_CONTENT.pack,
  adventureId: PRODUCTION_CONTENT.adventureId,
};
const CONTENT = PRODUCTION_CONTENT.pack.combatContent;
const ADVENTURE = PRODUCTION_CONTENT.adventure;
const HOST = "player-host";

function control(state: SessionCoreState): SessionControlContext {
  return {
    connectedPlayerIds: [HOST],
    effectiveControllerByMemberId: Object.fromEntries(
      state.partySlots.map((slot) => [slot.memberId, state.hostPlayerId]),
    ),
  };
}

function send(state: SessionCoreState, intent: SessionIntent): SessionCoreState {
  const result = dispatchSessionIntent(state, HOST, intent, CONTEXT, control(state));
  expect(`${intent.type}:${String(result.accepted)}:${result.error ?? ""}`).toBe(`${intent.type}:true:`);
  return result.state;
}

function actorTargets(targets: readonly LegalTarget[]): readonly Extract<LegalTarget, { kind: "actor" }>[] {
  return targets.filter((target): target is Extract<LegalTarget, { kind: "actor" }> => target.kind === "actor");
}

/**
 * A deterministic hero policy built only from the shared legality queries. It never reaches
 * past `listLegalActions` / `listLegalTargets`, so it can only do what a player could.
 */
function heroIntent(combat: CombatState, actorId: string): SessionIntent {
  const actor = combat.actors[actorId];
  if (!actor) return { type: "end-turn" };
  const actions = listLegalActions(combat, actorId, CONTENT).filter((entry) => entry.enabled);
  const use = (source: ActionSource, target: ActionTarget): SessionIntent =>
    ({ type: "use-action", action: source, target });

  // 1. Undo a state the hero is stuck in.
  for (const actionId of ["stand", "escape-grab"]) {
    const entry = actions.find((candidate) => candidate.source.kind === "context" && candidate.actionId === actionId);
    if (entry) return use(entry.source, { kind: "none" });
  }
  // 2. Open the way when the map gates it behind a lever.
  const interact = actions.find((candidate) => candidate.actionId === "interact-lever");
  if (interact) {
    const target = listLegalTargets(combat, actorId, interact.source, CONTENT)
      .find((candidate): candidate is Extract<LegalTarget, { kind: "object" }> => candidate.kind === "object");
    if (target) return use(interact.source, { kind: "object", objectId: target.objectId });
  }
  // 3. Hit whatever is in reach, cheapest option first so a turn buys the most attacks.
  const offensive = actions
    .filter((candidate) => CONTENT.actions[candidate.actionId]?.targeting === "enemy" && candidate.timing.kind === "turn")
    .map((candidate) => ({
      entry: candidate,
      target: actorTargets(listLegalTargets(combat, actorId, candidate.source, CONTENT))[0],
      cost: candidate.timing.kind === "turn" ? candidate.timing.actions : 9,
    }))
    .filter((candidate) => candidate.target)
    .sort((left, right) => left.cost - right.cost || left.entry.actionId.localeCompare(right.entry.actionId));
  const best = offensive[0];
  if (best?.target) return use(best.entry.source, { kind: "actor", actorId: best.target.actorId });

  // 4. With nothing in reach, put the shield up before closing.
  const shield = actions.find((candidate) => candidate.actionId === "raise-shield");
  if (shield && !actor.shieldRaised) return use(shield.source, { kind: "none" });
  // 5. Otherwise close the distance, but only when the step actually shortens it.
  const stride = actions.find((candidate) => candidate.source.kind === "basic" && candidate.actionId === "stride");
  const enemy = Object.values(combat.actors)
    .filter((candidate) => candidate.team === "enemies" && !candidate.defeated)
    .sort((left, right) => left.id.localeCompare(right.id))[0];
  if (stride && enemy) {
    const destination = listLegalTargets(combat, actorId, stride.source, CONTENT)
      .filter((candidate): candidate is Extract<LegalTarget, { kind: "tile" }> => candidate.kind === "tile")
      .sort((left, right) =>
        gridDistance(left.position, enemy.position) - gridDistance(right.position, enemy.position) ||
        left.costFeet - right.costFeet ||
        left.position.y - right.position.y ||
        left.position.x - right.position.x)[0];
    if (destination && gridDistance(destination.position, enemy.position) < gridDistance(actor.position, enemy.position)) {
      return {
        type: "use-action",
        action: stride.source,
        target: { kind: "tile", position: destination.position, facing: actor.facing },
      };
    }
  }
  return { type: "end-turn" };
}

/** Mirrors the server pump: enemies and reactions resolve through the authoritative path. */
function pumpServer(state: SessionCoreState): SessionCoreState {
  let current = state;
  for (let guard = 0; guard < 512; guard += 1) {
    const combat = current.combat;
    if (!combat || combat.outcome) return current;
    let command: CombatCommand | null;
    const pending = combat.pendingReaction;
    if (pending) {
      const candidate = pending.candidates[0];
      command = candidate
        ? {
            type: "use-reaction",
            id: "pump",
            sequence: -1,
            actorId: candidate.actorId,
            triggerId: pending.triggerId,
            cardInstanceId: candidate.cardInstanceId,
          }
        : { type: "pass-reaction", id: "pump", sequence: -1, actorId: combat.turn.activeActorId, triggerId: pending.triggerId };
    } else {
      const active = combat.actors[combat.turn.activeActorId];
      if (!active || active.team === "heroes") return current;
      command = chooseAiCommand(combat, CONTENT);
    }
    if (!command) throw new Error("The server pump reached a non-human boundary with no command.");
    const result = dispatchServerCombatCommand(current, command, CONTEXT);
    expect(`pump:${String(result.accepted)}:${result.error ?? ""}`).toBe("pump:true:");
    current = result.state;
  }
  throw new Error("The server pump exceeded its command guard.");
}

describe("tutorial prefix completes through the authoritative session", () => {
  it("plays every encounter to a real combat outcome and finishes the adventure", () => {
    let state = createSessionCoreState(
      { playerId: HOST, displayName: "Host", sessionId: "session-tutorial", adventureSeed: 4242 },
      CONTEXT,
    );
    state = send(state, { type: "set-party-composition", actorDefinitionIds: ["hero.aerin", "hero.lyra", "hero.brom"] });
    state = send(state, { type: "begin-adventure" });

    const played: string[] = [];
    const rewards: string[] = [];
    for (let guard = 0; guard < 4_000 && state.adventure?.phase !== "complete"; guard += 1) {
      const adventure = state.adventure;
      if (!adventure) throw new Error("The session lost its adventure.");
      if (adventure.phase === "between-encounters") {
        state = send(state, { type: "start-encounter" });
        if (state.adventure?.currentEncounterId) played.push(state.adventure.currentEncounterId);
        state = pumpServer(state);
        continue;
      }
      if (adventure.phase === "reward" && adventure.pendingReward) {
        rewards.push(adventure.pendingReward.rewardId);
        state = send(state, { type: "choose-reward", rewardId: adventure.pendingReward.rewardId, choiceIndex: 0 });
        continue;
      }
      if (adventure.phase === "combat") {
        const combat = state.combat;
        if (!combat) throw new Error("The adventure is in combat with no combat state.");
        // The hero acts; the server then resolves everything up to the next human boundary
        // and, when the encounter ends, finalizeCombat() hands the real hash to the
        // adventure. Nothing here fabricates an EncounterResult.
        state = send(state, heroIntent(combat, combat.turn.activeActorId));
        state = pumpServer(state);
        continue;
      }
      throw new Error(`The adventure stalled in phase "${adventure.phase}".`);
    }

    expect(state.adventure?.phase).toBe("complete");
    expect(played).toEqual([...ADVENTURE.encounterIds]);
    const inPlayOrder = ADVENTURE.encounterIds.flatMap((encounterId) =>
      ADVENTURE.rewards.filter((reward) => reward.afterEncounterId === encounterId).map((reward) => reward.id));
    expect(rewards).toEqual(inPlayOrder);
    expect(state.combat).toBeNull();
    // Every reward the party took is owned, which is what the next encounter's loadout reads.
    const owned = Object.keys(state.adventure?.collection.cards ?? {}).length
      + Object.keys(state.adventure?.collection.equipment ?? {}).length;
    expect(owned).toBeGreaterThan(0);
  });
});
