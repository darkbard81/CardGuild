import type { CombatState } from "../game";

/** Presentation derives targets and completion from the same IDs/used flags as victory. */
export function destructionObjectives(state: CombatState) {
  return (state.rules?.victory?.objectIds ?? []).flatMap((id, index) => {
    const object = state.map.objects[id];
    return object?.interaction.kind === "destroy-obstacle" ? [{ object, number: index + 1, complete: object.used }] : [];
  });
}

export function destructionObjectiveLabel(state: CombatState, objectId: string): string | undefined {
  const target = destructionObjectives(state).find(target => target.object.id === objectId && !target.complete);
  return target ? `파괴 목표 ${target.number} · ${target.object.name}` : undefined;
}
