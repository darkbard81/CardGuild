import type { RngState } from "./types";

const UINT32_RANGE = 0x1_0000_0000;
const FALLBACK_SEED = 0x6d2b_79f5;

export function createRng(seed: number): RngState {
  const value = seed >>> 0;
  return { value: value === 0 ? FALLBACK_SEED : value };
}

export function nextUint32(rng: RngState): { readonly rng: RngState; readonly value: number } {
  let value = rng.value >>> 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  value >>>= 0;
  return { rng: { value }, value };
}

export function nextInt(
  rng: RngState,
  minimum: number,
  maximum: number,
): { readonly rng: RngState; readonly value: number } {
  if (!Number.isInteger(minimum) || !Number.isInteger(maximum) || maximum < minimum) {
    throw new Error(`Invalid integer range: ${minimum}..${maximum}`);
  }

  const span = maximum - minimum + 1;
  const limit = Math.floor(UINT32_RANGE / span) * span;
  let current = rng;

  for (;;) {
    const next = nextUint32(current);
    current = next.rng;
    if (next.value < limit) {
      return { rng: current, value: minimum + (next.value % span) };
    }
  }
}

export function shuffle<T>(
  values: readonly T[],
  rng: RngState,
): { readonly values: readonly T[]; readonly rng: RngState } {
  const shuffled = [...values];
  let current = rng;

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const next = nextInt(current, 0, index);
    current = next.rng;
    const other = next.value;
    const held = shuffled[index];
    shuffled[index] = shuffled[other] as T;
    shuffled[other] = held as T;
  }

  return { values: shuffled, rng: current };
}

export function rollDice(
  rng: RngState,
  count: number,
  sides: number,
): { readonly rng: RngState; readonly total: number; readonly rolls: readonly number[] } {
  let current = rng;
  const rolls: number[] = [];

  for (let index = 0; index < count; index += 1) {
    const next = nextInt(current, 1, sides);
    current = next.rng;
    rolls.push(next.value);
  }

  return {
    rng: current,
    total: rolls.reduce((sum, value) => sum + value, 0),
    rolls,
  };
}
