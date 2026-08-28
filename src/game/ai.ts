import { gridDistance } from "./grid";
import { listLegalActions, listLegalTargets } from "./queries";
import { facingToward } from "./rules";
import type { ActionSource, CombatCommand, CombatContent, CombatState, LegalTarget } from "./types";

function commandId(state: CombatState, label: string): string {
  return `ai-${String(state.sequence + 1).padStart(4, "0")}-${label}`;
}

function useActionCommand(
  state: CombatState,
  actorId: string,
  source: ActionSource,
  target: Extract<CombatCommand, { type: "use-action" }>["target"],
): CombatCommand {
  return {
    type: "use-action",
    id: commandId(state, source.id),
    sequence: state.sequence + 1,
    actorId,
    action: source,
    target,
  };
}

export function chooseAiCommand(state: CombatState, content: CombatContent): CombatCommand | null {
  if (state.outcome || state.pendingReaction) return null;
  const actor = state.actors[state.turn.activeActorId];
  if (!actor || actor.team !== "enemies") return null;

  const actions = listLegalActions(state, actor.id, content);
  const contextPriority = ["stand", "escape-grab"];
  for (const actionId of contextPriority) {
    const action = actions.find((candidate) => candidate.actionId === actionId && candidate.enabled);
    if (action) return useActionCommand(state, actor.id, action.source, { kind: "none" });
  }

  for (const actionId of ["knockdown", "strike"]) {
    const action = actions.find((candidate) => candidate.actionId === actionId && candidate.enabled);
    if (!action) continue;
    const target = listLegalTargets(state, actor.id, action.source, content).find(
      (candidate): candidate is Extract<LegalTarget, { kind: "actor" }> => candidate.kind === "actor",
    );
    if (target) return useActionCommand(state, actor.id, action.source, { kind: "actor", actorId: target.actorId });
  }

  const stride = actions.find((candidate) => candidate.actionId === "stride" && candidate.enabled);
  const hero = Object.values(state.actors)
    .filter((candidate) => candidate.team === "heroes" && !candidate.defeated)
    .sort((left, right) => left.id.localeCompare(right.id))[0];
  if (stride && hero) {
    const destination = listLegalTargets(state, actor.id, stride.source, content)
      .filter((candidate): candidate is Extract<LegalTarget, { kind: "tile" }> => candidate.kind === "tile")
      .sort(
        (left, right) =>
          gridDistance(left.position, hero.position) - gridDistance(right.position, hero.position) ||
          left.costFeet - right.costFeet ||
          left.position.y - right.position.y ||
          left.position.x - right.position.x,
      )[0];
    if (destination && gridDistance(destination.position, hero.position) < gridDistance(actor.position, hero.position)) {
      return useActionCommand(state, actor.id, stride.source, {
        kind: "tile",
        position: destination.position,
        facing: facingToward(destination.position, hero.position),
      });
    }
  }

  return {
    type: "end-turn",
    id: commandId(state, "end-turn"),
    sequence: state.sequence + 1,
    actorId: actor.id,
  };
}
