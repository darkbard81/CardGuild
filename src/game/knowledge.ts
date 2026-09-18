import { SKILL_IDS, resolveStatisticModifier } from "./statistics";
import type { ActorState, CombatContent, CombatState, SkillId } from "./types";

/** Stable tie order is SKILL_IDS, never object insertion order. */
export function recallKnowledgeSkill(target: ActorState, content: CombatContent): SkillId {
  const skills = target.statProfile.kind === "creature" ? SKILL_IDS.filter(skill => Object.hasOwn(target.statProfile.stats.skills, skill)) : SKILL_IDS;
  let selected: SkillId = skills[0] ?? "nature";
  let highest = -Infinity;
  for (const skill of skills) {
    const value = resolveStatisticModifier(target, { kind: "skill", id: skill }, { content }).value;
    if (value > highest) { selected = skill; highest = value; }
  }
  return selected;
}

/** PF2e standard DC by level, -1 through 25. */
export function levelDifficultyClass(level: number): number {
  const dcs = [13, 14, 15, 16, 18, 19, 20, 22, 23, 24, 26, 27, 28, 30, 31, 32, 34, 35, 36, 38, 39, 40, 42, 44, 46, 48, 50];
  if (!Number.isInteger(level) || level < -1 || level > 25) throw new Error("Knowledge target level must be -1 through 25.");
  return dcs[level + 1]!;
}

export function canInspectActor(state: CombatState, actorId: string, team: ActorState["team"] = "heroes"): boolean {
  const target = state.actors[actorId];
  return Boolean(target && (target.team === team || state.knowledge?.some(entry => entry.targetId === actorId && entry.success && state.actors[entry.actorId]?.team === team)));
}

export function canRecallKnowledge(state: CombatState, actorId: string, targetId: string): boolean {
  const actor = state.actors[actorId], target = state.actors[targetId];
  return Boolean(actor && target && actor.team !== target.team && !target.defeated &&
    !canInspectActor(state, targetId, actor.team) && !state.knowledge?.some(entry => entry.actorId === actorId && entry.targetId === targetId));
}
