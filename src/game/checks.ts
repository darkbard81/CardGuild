import { nextInt } from "./rng";
import type { DegreeOfSuccess, RngState } from "./types";

const DEGREES: readonly DegreeOfSuccess[] = [
  "critical-failure",
  "failure",
  "success",
  "critical-success",
];

function baseDegree(total: number, dc: number): DegreeOfSuccess {
  if (total >= dc + 10) return "critical-success";
  if (total >= dc) return "success";
  if (total <= dc - 10) return "critical-failure";
  return "failure";
}

function shiftDegree(degree: DegreeOfSuccess, shift: -1 | 0 | 1): DegreeOfSuccess {
  const index = DEGREES.indexOf(degree);
  const nextIndex = Math.max(0, Math.min(DEGREES.length - 1, index + shift));
  return DEGREES[nextIndex] as DegreeOfSuccess;
}

export function resolveDegree(roll: number, modifier: number, dc: number): {
  readonly baseDegree: DegreeOfSuccess;
  readonly degree: DegreeOfSuccess;
  readonly total: number;
} {
  const total = roll + modifier;
  const initial = baseDegree(total, dc);
  const shift = roll === 20 ? 1 : roll === 1 ? -1 : 0;
  return { baseDegree: initial, degree: shiftDegree(initial, shift), total };
}

export function rollCheck(rng: RngState, modifier: number, dc: number): {
  readonly rng: RngState;
  readonly roll: number;
  readonly total: number;
  readonly baseDegree: DegreeOfSuccess;
  readonly degree: DegreeOfSuccess;
} {
  const next = nextInt(rng, 1, 20);
  return { rng: next.rng, roll: next.value, ...resolveDegree(next.value, modifier, dc) };
}

export function degreeProbabilities(modifier: number, dc: number): Readonly<Record<DegreeOfSuccess, number>> {
  const counts: Record<DegreeOfSuccess, number> = {
    "critical-success": 0,
    success: 0,
    failure: 0,
    "critical-failure": 0,
  };

  for (let roll = 1; roll <= 20; roll += 1) {
    counts[resolveDegree(roll, modifier, dc).degree] += 1;
  }

  return {
    "critical-success": counts["critical-success"] / 20,
    success: counts.success / 20,
    failure: counts.failure / 20,
    "critical-failure": counts["critical-failure"] / 20,
  };
}
